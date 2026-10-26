package simulation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"corodev/evacuation/internal/world"
)

func TestHTTPDecisionClientExactContractAndAuthentication(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/prefix/paso" || r.Header.Get("x-api-key") != "test-only-key" || r.Header.Get("Content-Type") != "application/json" {
			t.Error("incorrect HTTP method, path, key or content type")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !reflect.DeepEqual(body, map[string]any{"sobrevivienteId": "S1", "nodoActual": "A", "turno": float64(4)}) {
			t.Errorf("wrong Spanish request: %#v %v", body, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"siguienteNodo":"B"}`))
	}))
	defer server.Close()
	client, err := NewHTTPDecisionClient(server.URL+"/prefix", "test-only-key", 500*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	response, err := client.NextStep(context.Background(), world.StepRequest{SurvivorID: "S1", CurrentNode: "A", Turn: 4})
	if err != nil || response.NextNode != "B" {
		t.Fatalf("HTTP result: %+v %v", response, err)
	}
}

func TestHTTPInvalidResponsesStayAndCountFailures(t *testing.T) {
	for _, body := range []string{`{}`, `{"siguienteNodo":null}`, `{"siguienteNodo":""}`, `{"siguienteNodo":4}`, `{"siguienteNodo":"B","hidden":true}`, `{"siguienteNodo":"B"} {}`, `invalid`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
			defer server.Close()
			client, err := NewHTTPDecisionClient(server.URL, "test-only-key", 500*time.Millisecond)
			if err != nil {
				t.Fatal(err)
			}
			defer client.CloseIdleConnections()
			s := create(t, chain(3), Config{InitialSurvivors: []world.Survivor{survivor("S1", "A")}}, client)
			w := step(t, s)
			if w.Survivors[0].CurrentNode != "A" || w.Metrics.RequestsInvalid != 1 || w.Metrics.Availability != 0 {
				t.Fatalf("malformed HTTP decision moved survivor: %+v", w)
			}
		})
	}
}

func TestHTTPTimeoutKeepsSurvivorInPlace(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		case <-time.After(120 * time.Millisecond):
			_, _ = w.Write([]byte(`{"siguienteNodo":"B"}`))
		}
	}))
	defer server.Close()
	client, err := NewHTTPDecisionClient(server.URL, "test-only-key", 20*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	s := create(t, chain(3), Config{InitialSurvivors: []world.Survivor{survivor("S1", "A")}}, client)
	w := step(t, s)
	if w.Survivors[0].CurrentNode != "A" || w.Metrics.RequestsTimeout != 1 || w.Metrics.RequestsSuccess != 0 {
		t.Fatalf("timeout fallback failed: %+v", w)
	}
}

func TestHTTPRejectsRedirectWithoutForwardingKey(t *testing.T) {
	var forwarded atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded.Store(true) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client, err := NewHTTPDecisionClient(server.URL, "test-only-key", 500*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	if _, err := client.NextStep(context.Background(), world.StepRequest{}); err == nil || forwarded.Load() {
		t.Fatal("redirect must fail without forwarding API key")
	}
}

func TestHTTPBodyTimeoutAfterFlushedHeadersIsNotInvalidJSON(t *testing.T) {
	for _, partialBody := range []string{"", `{"siguienteNodo":"B"}`} {
		t.Run(partialBody, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(partialBody))
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			defer server.Close()
			client, err := NewHTTPDecisionClient(server.URL, "test-only-key", 20*time.Millisecond)
			if err != nil {
				t.Fatal(err)
			}
			defer client.CloseIdleConnections()
			s := create(t, chain(3), Config{InitialSurvivors: []world.Survivor{survivor("S1", "A")}}, client)
			started := time.Now()
			w := step(t, s)
			if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
				t.Fatalf("20ms body timeout failed to bound the turn: %s", elapsed)
			}
			if w.Survivors[0].CurrentNode != "A" || w.Metrics.RequestsTimeout != 1 || w.Metrics.RequestsInvalid != 0 || w.Metrics.RequestsSuccess != 0 {
				t.Fatalf("body timeout misclassified or survivor moved: %+v", w)
			}
		})
	}
}

func TestHTTPFailureAndUpstreamTimeoutClassification(t *testing.T) {
	for _, status := range []int{401, 500, 408, 504} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(status) }))
			defer server.Close()
			client, err := NewHTTPDecisionClient(server.URL, "test-only-key", 500*time.Millisecond)
			if err != nil {
				t.Fatal(err)
			}
			defer client.CloseIdleConnections()
			s := create(t, chain(3), Config{InitialSurvivors: []world.Survivor{survivor("S1", "A")}}, client)
			w := step(t, s)
			if w.Survivors[0].CurrentNode != "A" {
				t.Fatal("failed HTTP response moved survivor")
			}
			if status == 408 || status == 504 {
				if w.Metrics.RequestsTimeout != 1 || w.Metrics.RequestsInvalid != 0 {
					t.Fatal("upstream deadline was not classified as timeout")
				}
			} else if w.Metrics.RequestsInvalid != 1 || w.Metrics.RequestsTimeout != 0 {
				t.Fatal("HTTP failure was not classified as invalid")
			}
		})
	}
}

func TestHTTPClientConfiguration(t *testing.T) {
	for _, url := range []string{"file:///tmp", "http://user:key@localhost", "http://localhost?secret=yes", "http://localhost#fragment", "not a url"} {
		if _, err := NewHTTPDecisionClient(url, "test-only-key", time.Second); err == nil {
			t.Fatalf("accepted unsafe decision URL: %s", url)
		}
	}
	if _, err := NewHTTPDecisionClient("http://localhost", "", 0); err == nil {
		t.Fatal("accepted missing key")
	}
	c, err := NewHTTPDecisionClient("http://localhost", "test-only-key", time.Second)
	if err != nil || c.timeout != 500*time.Millisecond {
		t.Fatal("HTTP deadline must be bounded to 500ms")
	}
	c.CloseIdleConnections()
}
