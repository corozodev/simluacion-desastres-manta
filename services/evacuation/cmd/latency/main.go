// Command latency measures client transport without changing the running world.
// Credentials stay in API_KEY; neither bodies, request headers nor IDs are saved.
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"corodev/evacuation/internal/world"
)

type sample struct {
	Operation              int      `json:"operation"`
	Attempt                int      `json:"attempt"`
	Route                  string   `json:"route"`
	Status                 int      `json:"status"`
	Protocol               string   `json:"protocol,omitempty"`
	NegotiatedProtocol     string   `json:"tls_negotiated_protocol,omitempty"`
	Reused                 bool     `json:"connection_reused"`
	DNSMS                  *float64 `json:"dns_ms"`
	TCPMS                  *float64 `json:"tcp_ms"`
	TLSMS                  *float64 `json:"tls_ms"`
	TTFBMS                 *float64 `json:"ttfb_ms"`
	TotalMS                float64  `json:"total_ms"`
	ConnectionAcquisitions int      `json:"connection_acquisitions"`
	TCPAttempts            int      `json:"tcp_attempts"`
	TLSHandshakes          int      `json:"tls_handshakes"`
	Failure                string   `json:"failure,omitempty"`
	Over500MS              bool     `json:"over_500ms"`
}

type operation struct {
	Index     int     `json:"index"`
	Status    int     `json:"last_status"`
	Attempts  int     `json:"decision_attempts"`
	Conflicts int     `json:"conflicts"`
	Success   bool    `json:"success"`
	TotalMS   float64 `json:"total_ms"`
	Failure   string  `json:"failure,omitempty"`
}

type stats struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50_ms"`
	P95   float64 `json:"p95_ms"`
	P99   float64 `json:"p99_ms"`
	Max   float64 `json:"max_ms"`
}

func summarize(values []float64) *stats {
	if len(values) == 0 {
		return nil
	}
	v := append([]float64{}, values...)
	sort.Float64s(v)
	p := func(q float64) float64 { return v[int(math.Ceil(q*float64(len(v))))-1] }
	return &stats{len(v), p(.5), p(.95), p(.99), v[len(v)-1]}
}

func validOrigin(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("base URL must be an origin without credentials, query or path")
	}
	if u.Scheme != "https" {
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "http" || ip == nil || !ip.IsLoopback() {
			return nil, errors.New("HTTP is permitted only for literal loopback addresses")
		}
	}
	return u, nil
}

func newClient(mode string, timeout time.Duration, connectIP string) (*http.Client, *http.Transport) {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.Proxy = nil // Do not silently measure an inherited proxy or expose its settings.
	t.DisableKeepAlives = mode == "new"
	t.ForceAttemptHTTP2 = false
	t.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, NextProtos: []string{"http/1.1"}}
	t.TLSNextProto = map[string]func(string, *tls.Conn) http.RoundTripper{} // Same HTTP/1.1 in both modes.
	t.MaxIdleConns = 2
	t.MaxIdleConnsPerHost = 2
	t.IdleConnTimeout = 30 * time.Second
	if connectIP != "" {
		d := &net.Dialer{Timeout: timeout}
		t.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			_, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			return d.DialContext(ctx, network, net.JoinHostPort(connectIP, port))
		}
	}
	return &http.Client{Transport: t, Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, t
}

func request(client *http.Client, base, route, key string, payload any, op, attempt int) (sample, []byte) {
	s := sample{Operation: op, Attempt: attempt, Route: route}
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			s.Failure = "request_json"
			return s, nil
		}
		body = bytes.NewReader(b)
	}
	r, err := http.NewRequest(http.MethodGet, base+route, body)
	if err != nil {
		s.Failure = "request"
		return s, nil
	}
	if payload != nil {
		r.Method = http.MethodPost
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("Accept", "application/json")
	if route == "/paso" && key != "" {
		r.Header.Set("x-api-key", key)
	}
	start := time.Now()
	var mu sync.Mutex
	var dns, tlsStarted time.Time
	tcpStarts := map[string]time.Time{}
	ms := func(d time.Duration) *float64 { v := float64(d) / float64(time.Millisecond); return &v }
	add := func(dst **float64, d time.Duration) {
		v := float64(d) / float64(time.Millisecond)
		if *dst != nil {
			v += **dst
		}
		*dst = &v // A returned sample must not share a subsequently mutated value.
	}
	trace := &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) { mu.Lock(); dns = time.Now(); mu.Unlock() },
		DNSDone: func(httptrace.DNSDoneInfo) {
			mu.Lock()
			if !dns.IsZero() {
				add(&s.DNSMS, time.Since(dns))
			}
			mu.Unlock()
		},
		ConnectStart: func(network, address string) {
			mu.Lock()
			s.TCPAttempts++
			tcpStarts[network+address] = time.Now()
			mu.Unlock()
		},
		ConnectDone: func(network, address string, _ error) {
			mu.Lock()
			if tcp := tcpStarts[network+address]; !tcp.IsZero() {
				add(&s.TCPMS, time.Since(tcp))
				delete(tcpStarts, network+address)
			}
			mu.Unlock()
		},
		TLSHandshakeStart: func() { mu.Lock(); s.TLSHandshakes++; tlsStarted = time.Now(); mu.Unlock() },
		TLSHandshakeDone: func(state tls.ConnectionState, _ error) {
			mu.Lock()
			s.NegotiatedProtocol = state.NegotiatedProtocol
			add(&s.TLSMS, time.Since(tlsStarted))
			mu.Unlock()
		},
		GotConn:              func(i httptrace.GotConnInfo) { mu.Lock(); s.Reused = i.Reused; s.ConnectionAcquisitions++; mu.Unlock() },
		GotFirstResponseByte: func() { mu.Lock(); s.TTFBMS = ms(time.Since(start)); mu.Unlock() },
	}
	r = r.WithContext(httptrace.WithClientTrace(r.Context(), trace))
	response, err := client.Do(r)
	var raw []byte
	if err == nil {
		s.Status = response.StatusCode
		s.Protocol = response.Proto
		raw, err = io.ReadAll(io.LimitReader(response.Body, 8*1024*1024+1))
		_ = response.Body.Close()
		if len(raw) > 8*1024*1024 {
			s.Failure = "body_limit"
			raw = nil
		}
	}
	// Hooks may run on connection goroutines. Snapshot only after Do/body finish.
	mu.Lock()
	s.TotalMS = float64(time.Since(start)) / float64(time.Millisecond)
	s.Over500MS = s.TotalMS > 500
	mu.Unlock()
	if err != nil {
		var n net.Error
		if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &n) && n.Timeout()) {
			s.Failure = "transport_timeout"
		} else {
			s.Failure = "transport"
		}
	}
	if key != "" && bytes.Contains(raw, []byte(key)) {
		s.Failure = "credential_in_response"
		raw = nil
	}
	mu.Lock()
	result := s
	mu.Unlock()
	return result, raw
}

func validStep(state world.WorldSnapshot, survivor world.Survivor, raw []byte) bool {
	var out map[string]json.RawMessage
	if json.Unmarshal(raw, &out) != nil || len(out) != 1 {
		return false
	}
	var next string
	if json.Unmarshal(out["siguienteNodo"], &next) != nil || next == "" {
		return false
	}
	if next == survivor.CurrentNode {
		return true
	}
	if state.Graph == nil {
		return false
	}
	blocked := map[string]bool{}
	for _, id := range state.BlockedEdges {
		blocked[id] = true
	}
	for _, e := range state.Graph.Edges {
		if !e.Blocked && !blocked[e.ID] && ((e.From == survivor.CurrentNode && e.To == next) || (!e.Directed && e.To == survivor.CurrentNode && e.From == next)) {
			return true
		}
	}
	return false
}

func measure(client *http.Client, base, endpoint, key string, count, retries int, interval time.Duration) map[string]any {
	requests := []sample{}
	setup := []sample{}
	operations := []operation{}
	var graph world.Graph
	setupFailure := ""
	setupRoute := endpoint
	if endpoint == "/paso" {
		setupRoute = "/grafo"
	}
	warmup, raw := request(client, base, setupRoute, key, nil, -1, -1)
	setup = append(setup, warmup)
	if warmup.Failure != "" || warmup.Status != 200 {
		setupFailure = "setup_request"
	}
	if endpoint == "/paso" && setupFailure == "" && (json.Unmarshal(raw, &graph) != nil || len(graph.Nodes) == 0) {
		setupFailure = "setup_graph"
	}
	requestedCount := count
	if setupFailure != "" {
		count = 0
	}
	initialTurn, finalTurn := -1, -1
	for i := 0; i < count; i++ {
		started := time.Now()
		o := operation{Index: i}
		for attempt := 0; attempt <= retries; attempt++ {
			if setupFailure != "" {
				o.Failure = setupFailure
				break
			}
			if endpoint != "/paso" {
				s, _ := request(client, base, endpoint, "", nil, i, attempt)
				requests = append(requests, s)
				o.Attempts++
				o.Status = s.Status
				o.Success = s.Status == 200 && s.Failure == ""
				o.Failure = s.Failure
				break
			}
			s, raw := request(client, base, "/estado", key, nil, i, attempt)
			requests = append(requests, s)
			if s.Failure != "" || s.Status != 200 {
				o.Failure = "snapshot_request"
				break
			}
			var state world.WorldSnapshot
			if json.Unmarshal(raw, &state) != nil {
				o.Failure = "snapshot_json"
				break
			}
			if state.GraphVersion != graph.Version {
				o.Failure = "graph_version_changed"
				break
			}
			state.Graph = &graph // GET /estado deliberately omits this local-only field.
			if initialTurn < 0 {
				initialTurn = state.Turn
			}
			finalTurn = state.Turn
			var active *world.Survivor
			for n := range state.Survivors {
				if state.Survivors[n].Status == world.Active {
					active = &state.Survivors[n]
					break
				}
			}
			if active == nil {
				o.Failure = "no_active_survivor"
				break
			}
			s, raw = request(client, base, "/paso", key, world.StepRequest{SurvivorID: active.ID, CurrentNode: active.CurrentNode, Turn: state.Turn}, i, attempt)
			requests = append(requests, s)
			o.Attempts++
			o.Status = s.Status
			if s.Failure != "" {
				o.Failure = s.Failure
				break
			}
			if s.Status == 409 {
				o.Conflicts++
				o.Failure = "conflict_exhausted"
				continue
			}
			if s.Status != 200 {
				o.Failure = "decision_status"
				break
			}
			if !validStep(state, *active, raw) {
				o.Failure = "decision_contract"
				requests[len(requests)-1].Failure = o.Failure
				break
			}
			o.Success = true
			o.Failure = ""
			break
		}
		o.TotalMS = float64(time.Since(started)) / float64(time.Millisecond)
		operations = append(operations, o)
		if i+1 < count && interval > 0 {
			time.Sleep(interval)
		}
	}
	all, success, ops := []float64{}, []float64{}, []float64{}
	statuses := map[int]int{}
	opSuccess, conflicts, transportFailures, timeouts, reused, over500 := 0, 0, 0, 0, 0, 0
	stages := map[string][]float64{"dns": {}, "tcp": {}, "tls": {}, "ttfb": {}}
	for _, s := range requests {
		if s.Route != endpoint {
			continue
		}
		all = append(all, s.TotalMS)
		statuses[s.Status]++
		if s.Status == 200 && s.Failure == "" {
			success = append(success, s.TotalMS)
		}
		if s.Failure != "" {
			transportFailures++
		}
		if s.Failure == "transport_timeout" {
			timeouts++
		}
		if s.Reused {
			reused++
		}
		if s.Over500MS {
			over500++
		}
		for k, v := range map[string]*float64{"dns": s.DNSMS, "tcp": s.TCPMS, "tls": s.TLSMS, "ttfb": s.TTFBMS} {
			if v != nil {
				stages[k] = append(stages[k], *v)
			}
		}
	}
	for _, o := range operations {
		ops = append(ops, o.TotalMS)
		conflicts += o.Conflicts
		if o.Success {
			opSuccess++
		}
	}
	stageStats := map[string]*stats{}
	for k, v := range stages {
		stageStats[k] = summarize(v)
	}
	return map[string]any{"setup_excluded_from_statistics": setup, "setup_failure": setupFailure, "requests": requests, "operations": operations, "summary": map[string]any{"requested_operations": requestedCount, "attempted_operations": len(operations), "unstarted_operations": requestedCount - len(operations), "successful_operations": opSuccess, "logical_operation_failures": len(operations) - opSuccess, "operation_availability": func() any {
		if len(operations) == 0 {
			return nil
		}
		return float64(opSuccess) / float64(len(operations))
	}(), "endpoint_attempts": len(all), "decision_attempts": len(all), "successful_attempts": len(success), "attempt_availability": func() any {
		if len(all) == 0 {
			return nil
		}
		return float64(len(success)) / float64(len(all))
	}(), "conflicts_409": conflicts, "status_counts": statuses, "failures": transportFailures, "timeouts": timeouts, "over_500ms_attempts": over500, "reused_connections": reused, "attempt_all_status_latency": summarize(all), "attempt_success_latency": summarize(success), "logical_operation_latency_including_snapshot_retries": summarize(ops), "attempt_stages_observed_only": stageStats, "initial_turn": initialTurn, "final_turn": finalTurn}}
}

func run() error {
	base := flag.String("base-url", "", "HTTPS API origin, or literal HTTP loopback")
	output := flag.String("output", "", "private JSON report path")
	endpoint := flag.String("endpoint", "/paso", "/paso, /healthz or /estado")
	mode := flag.String("connection-mode", "both", "new, reuse or both")
	count := flag.Int("samples", 100, "logical operations per connection mode (1..1000)")
	retries := flag.Int("max-retries", 2, "409 retries per logical operation (0..3)")
	interval := flag.Duration("interval", 250*time.Millisecond, "sleep between sequential operations (at least 100ms)")
	timeout := flag.Duration("timeout", 10*time.Second, "per-request transport deadline, independent of 500ms reporting target")
	vantage := flag.String("vantage", "unspecified invoking client", "explicit observation location")
	connectIP := flag.String("connect-ip", "", "optional explicit IP override; skips DNS but preserves TLS hostname verification")
	flag.Parse()
	_, err := validOrigin(*base)
	if err != nil {
		return err
	}
	if *output == "" || *count < 1 || *count > 1000 || *retries < 0 || *retries > 3 || *interval < 100*time.Millisecond || *timeout <= 0 || *timeout > 30*time.Second {
		return errors.New("require output, samples 1..1000, retries 0..3, interval >=100ms and timeout <=30s")
	}
	if *connectIP != "" && net.ParseIP(*connectIP) == nil {
		return errors.New("connect-ip must be a literal IP address")
	}
	if *endpoint != "/paso" && *endpoint != "/healthz" && *endpoint != "/estado" {
		return errors.New("unsupported endpoint")
	}
	modes := []string{*mode}
	if *mode == "both" {
		modes = []string{"new", "reuse"}
	} else if *mode != "new" && *mode != "reuse" {
		return errors.New("unsupported connection mode")
	}
	key := strings.TrimSpace(os.Getenv("API_KEY"))
	if *endpoint == "/paso" && key == "" {
		return errors.New("set API_KEY privately in the environment")
	}
	report := map[string]any{"recorded_at": time.Now().UTC().Format(time.RFC3339Nano), "phase": "3B.1", "base_url": strings.TrimRight(*base, "/"), "endpoint": *endpoint, "vantage": *vantage, "workers": 1, "operation_interval": interval.String(), "timeout": timeout.String(), "max_retries": *retries, "protocol": "HTTP/1.1 in both modes", "tls_verification": true, "redirects_followed": false, "inherited_proxy_used": false, "connect_ip_override": *connectIP, "methodology": "nearest-rank percentiles; null stages mean no observed event; logical /paso operation includes GET /estado and all POST retries; all HTTP statuses remain in attempt statistics; transport deadline and 500ms target reported separately"}
	results := map[string]any{}
	complete := true
	for _, m := range modes {
		client, transport := newClient(m, *timeout, *connectIP)
		results[m] = measure(client, strings.TrimRight(*base, "/"), *endpoint, key, *count, *retries, *interval)
		if results[m].(map[string]any)["summary"].(map[string]any)["successful_operations"] != *count {
			complete = false
		}
		transport.CloseIdleConnections()
	}
	report["connection_modes"] = results
	report["complete"] = complete
	b, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if key != "" && bytes.Contains(b, []byte(key)) {
		return errors.New("refusing report containing credential")
	}
	if err = os.MkdirAll(filepath.Dir(*output), 0700); err != nil {
		return err
	}
	if err = os.WriteFile(*output, append(b, '\n'), 0600); err != nil {
		return err
	}
	if err = os.Chmod(*output, 0600); err != nil {
		return err
	}
	for _, m := range modes {
		v := results[m].(map[string]any)
		b, _ := json.Marshal(map[string]any{"mode": m, "summary": v["summary"]})
		fmt.Println(string(b))
	}
	if !complete {
		return errors.New("some logical operations failed; report preserves all attempts and failures")
	}
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "latency probe failed:", err)
		os.Exit(1)
	}
}
