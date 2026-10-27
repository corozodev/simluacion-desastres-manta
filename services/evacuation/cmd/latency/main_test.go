package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"corodev/evacuation/internal/world"
)

func TestRejectUnsafeOrigins(t *testing.T) {
	for _, u := range []string{"http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?secret=x", "https://example.com/#x", "ftp://example.com"} {
		if _, err := validOrigin(u); err == nil {
			t.Fatal("unsafe origin accepted")
		}
	}
	for _, u := range []string{"https://example.com", "http://127.0.0.1:8080", "http://[::1]:8080"} {
		if _, err := validOrigin(u); err != nil {
			t.Fatal("safe origin rejected")
		}
	}
}

func TestConnectionReuseIsMeasured(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer s.Close()
	for _, mode := range []string{"new", "reuse"} {
		c, tr := newClient(mode, time.Second, "")
		for n := 0; n < 4; n++ {
			v, _ := request(c, s.URL, "/healthz", "", nil, n, 0)
			if v.Status != 200 || v.Failure != "" {
				t.Fatal("request failed")
			}
			if v.Reused != (mode == "reuse" && n > 0) {
				t.Fatal("connection reuse accounting incorrect")
			}
			if n > 0 && mode == "reuse" && v.TCPMS != nil {
				t.Fatal("unobserved TCP stage must remain null")
			}
		}
		tr.CloseIdleConnections()
	}
}

func TestDecisionNeighborAndBlockedEdgeFromSeparateGraph(t *testing.T) {
	for _, blocked := range []bool{false, true} {
		g := world.Graph{Version: "v", Nodes: []world.GraphNode{{ID: "from"}, {ID: "to"}}, Edges: []world.GraphEdge{{ID: "edge", From: "from", To: "to"}}}
		state := world.WorldSnapshot{GraphVersion: "v", Turn: 1, Survivors: []world.Survivor{{ID: "s", CurrentNode: "from", Status: world.Active}}}
		if blocked {
			state.BlockedEdges = []string{"edge"}
		}
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/grafo":
				_ = json.NewEncoder(w).Encode(g)
			case "/estado":
				_ = json.NewEncoder(w).Encode(state)
			case "/paso":
				_, _ = w.Write([]byte(`{"siguienteNodo":"to"}`))
			}
		}))
		c, tr := newClient("reuse", time.Second, "")
		r := measure(c, s.URL, "/paso", "test-only-key", 1, 0, 0)
		tr.CloseIdleConnections()
		s.Close()
		summary := r["summary"].(map[string]any)
		if blocked {
			if summary["successful_operations"] != 0 || summary["successful_attempts"] != 0 || r["requests"].([]sample)[1].Failure != "decision_contract" {
				t.Fatal("blocked movement was counted successful")
			}
		} else if summary["successful_operations"] != 1 || summary["successful_attempts"] != 1 {
			t.Fatal("valid neighboring movement rejected")
		}
		setup := r["setup_excluded_from_statistics"].([]sample)
		if len(setup) != 1 || setup[0].Route != "/grafo" || summary["endpoint_attempts"] != 1 {
			t.Fatal("graph setup contaminated attempt statistics")
		}
	}
}

func TestConflictsRemainInAttemptsAndOperationRetry(t *testing.T) {
	key := "test-only-do-not-log"
	var decisions atomic.Int64
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/grafo" {
			_ = json.NewEncoder(w).Encode(world.Graph{Nodes: []world.GraphNode{{ID: "n"}}})
			return
		}
		if r.URL.Path == "/estado" {
			if r.Header.Get("x-api-key") != "" {
				t.Error("privileged key sent on public GET")
			}
			_ = json.NewEncoder(w).Encode(world.WorldSnapshot{Turn: 2, Survivors: []world.Survivor{{ID: "s", CurrentNode: "n", Status: world.Active}}})
			return
		}
		if r.Header.Get("x-api-key") != key {
			w.WriteHeader(401)
			return
		}
		if decisions.Add(1) == 1 {
			w.WriteHeader(409)
			_, _ = w.Write([]byte(`{"error":{}}`))
			return
		}
		_, _ = w.Write([]byte(`{"siguienteNodo":"n"}`))
	}))
	defer s.Close()
	c, tr := newClient("reuse", time.Second, "")
	defer tr.CloseIdleConnections()
	r := measure(c, s.URL, "/paso", key, 3, 1, 0)
	sum := r["summary"].(map[string]any)
	if sum["decision_attempts"] != 4 || sum["successful_operations"] != 3 || sum["conflicts_409"] != 1 || sum["attempt_availability"] != float64(3)/4 {
		t.Fatal("conflicts or logical operation accounting incorrect")
	}
	b, _ := json.Marshal(r)
	if strings.Contains(string(b), key) || strings.Contains(string(b), "sobrevivienteId") {
		t.Fatal("report exposed private request data")
	}
}

func TestCredentialsNeverFollowRedirectOrAppearInResponseReport(t *testing.T) {
	var reached atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached.Store(true) }))
	defer target.Close()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 302) }))
	defer s.Close()
	c, tr := newClient("reuse", time.Second, "")
	defer tr.CloseIdleConnections()
	v, _ := request(c, s.URL, "/paso", "test-only-key", map[string]int{"x": 1}, 0, 0)
	if v.Status != 302 || reached.Load() {
		t.Fatal("redirect credential boundary failed")
	}
	echo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(r.Header.Get("x-api-key"))) }))
	defer echo.Close()
	v, raw := request(c, echo.URL, "/paso", "test-only-key", map[string]int{"x": 1}, 0, 0)
	if v.Failure != "credential_in_response" || raw != nil {
		t.Fatal("credential echo was retained")
	}
}

func TestTLSVerificationAndTransportTimeout(t *testing.T) {
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer s.Close()
	c, tr := newClient("new", time.Second, "")
	v, _ := request(c, s.URL, "/healthz", "", nil, 0, 0)
	tr.CloseIdleConnections()
	if v.Failure != "transport" || v.TLSMS == nil || v.Status != 0 {
		t.Fatal("untrusted TLS certificate accepted")
	}
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(60 * time.Millisecond) }))
	defer slow.Close()
	c, tr = newClient("new", 10*time.Millisecond, "")
	v, _ = request(c, slow.URL, "/healthz", "", nil, 0, 0)
	tr.CloseIdleConnections()
	if v.Failure != "transport_timeout" {
		t.Fatal("transport timeout not classified")
	}
}

func TestHTTP1ALPNAgainstHTTP2EnabledTLSServer(t *testing.T) {
	s := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"status":"ok"}`)) }))
	s.EnableHTTP2 = true
	s.TLS = &tls.Config{NextProtos: []string{"h2", "http/1.1"}, MinVersion: tls.VersionTLS12}
	s.StartTLS()
	defer s.Close()
	c, tr := newClient("reuse", time.Second, "")
	defer tr.CloseIdleConnections()
	pool := x509.NewCertPool()
	pool.AddCert(s.Certificate())
	tr.TLSClientConfig.RootCAs = pool
	for n := 0; n < 2; n++ {
		v, _ := request(c, s.URL, "/healthz", "", nil, n, 0)
		if v.Status != 200 || v.Protocol != "HTTP/1.1" || v.Failure != "" {
			t.Fatal("HTTP/1 client negotiated an incompatible protocol")
		}
		if n == 0 && v.NegotiatedProtocol != "http/1.1" {
			t.Fatal("HTTP/1.1 ALPN not explicit")
		}
	}
}

func TestSetupFailureCreatesNoSyntheticOperations(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer s.Close()
	c, tr := newClient("reuse", time.Second, "")
	defer tr.CloseIdleConnections()
	r := measure(c, s.URL, "/paso", "test-only-key", 100, 2, 0)
	summary := r["summary"].(map[string]any)
	if summary["attempted_operations"] != 0 || summary["unstarted_operations"] != 100 || summary["operation_availability"] != nil || len(r["operations"].([]operation)) != 0 || summary["logical_operation_latency_including_snapshot_retries"].(*stats) != nil {
		t.Fatal("setup failure created synthetic latency samples")
	}
}
