package httpapi_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/httpapi"
	"corodev/evacuation/internal/world"
)

type engineFunc func(context.Context, world.WorldSnapshot, world.Survivor) world.DecisionResult

func (f engineFunc) NextStep(ctx context.Context, w world.WorldSnapshot, s world.Survivor) world.DecisionResult {
	return f(ctx, w, s)
}

func fixture() (*world.Graph, world.WorldSnapshot) {
	g := &world.Graph{Version: "test-1", Source: "synthetic-test-only", Nodes: []world.GraphNode{{ID: "A", Lat: 0, Lng: 0}, {ID: "B", Lat: 0, Lng: .001}, {ID: "C", Lat: 0, Lng: .002}, {ID: "D", Lat: 0, Lng: .003}}, Edges: []world.GraphEdge{{ID: "AB", From: "A", To: "B", DistanceM: 100, RoadType: "residential", SpeedMPS: 1.4}, {ID: "BC", From: "B", To: "C", DistanceM: 100, RoadType: "residential", SpeedMPS: 1.4}, {ID: "CD", From: "C", To: "D", DistanceM: 100, RoadType: "residential", SpeedMPS: 1.4}}, Shelters: []world.Shelter{{ID: "R1", NodeID: "C", Capacity: 200}, {ID: "R2", NodeID: "A", Capacity: 200}, {ID: "R3", NodeID: "B", Capacity: 200}, {ID: "R4", NodeID: "D", Capacity: 200}}}
	w := world.WorldSnapshot{Turn: 1, WorldVersion: 1, GraphVersion: g.Version, Graph: g, Survivors: []world.Survivor{{ID: "S-0001", CurrentNode: "A", Status: world.Active}}, Shelters: g.Shelters}
	return g, w
}

func build(t testing.TB, store *world.Store, engine world.DecisionEngine, timeout time.Duration) http.Handler {
	t.Helper()
	g, _ := fixture()
	h, err := httpapi.New(store, engine, g, httpapi.Options{APIKey: "test-only-key", DecisionTimeout: timeout, AllowedOrigins: []string{"http://localhost:5173"}})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func invoke(h http.Handler, body, key string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/paso", bytes.NewBufferString(body))
	r.Header.Set("x-api-key", key)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

const validBody = `{"sobrevivienteId":"S-0001","nodoActual":"A","turno":1}`

func TestMobilityDiagnosticsKeepExactPasoOverHTTP(t *testing.T) {
	store := world.NewStore()
	_, w := fixture()
	w.Survivors[0].StationaryTurns = 3
	w.Survivors[0].ImmobilityReason = "wait_with_route"
	w.Survivors[0].TargetShelterID = "R3"
	w.Survivors[0].PlannedRoute = []string{"A", "B"}
	server := httptest.NewServer(build(t, store, decision.New(), 0))
	defer server.Close()
	for _, passenger := range []bool{false, true} {
		want := "B"
		if passenger {
			w.Survivors[0].VehicleID = "V-01"
			w.Survivors[0].ImmobilityReason = "aboard"
			want = "A"
		}
		store.Publish(w)
		req, err := http.NewRequest("POST", server.URL+"/paso", bytes.NewBufferString(validBody))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("x-api-key", "test-only-key")
		req.Header.Set("Content-Type", "application/json")
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		err = json.NewDecoder(resp.Body).Decode(&body)
		resp.Body.Close()
		if err != nil || resp.StatusCode != 200 || len(body) != 1 || body["siguienteNodo"] != want {
			t.Fatalf("passenger=%v: status=%d body=%v error=%v", passenger, resp.StatusCode, body, err)
		}
		after, _ := store.Load()
		if after.Survivors[0].StationaryTurns != 3 || after.Survivors[0].CurrentNode != "A" {
			t.Fatal("HTTP decision changed the observable state")
		}
	}
}

func TestStepValidationAndExactResponse(t *testing.T) {
	store := world.NewStore()
	_, w := fixture()
	store.Publish(w)
	h := build(t, store, engineFunc(func(context.Context, world.WorldSnapshot, world.Survivor) world.DecisionResult {
		return world.DecisionResult{NextNode: "B"}
	}), 0)
	for _, tt := range []struct {
		name, body, key string
		status          int
	}{
		{"valid", validBody, "test-only-key", 200},
		{"missing key", validBody, "", 401},
		{"wrong key", validBody, "wrong", 401},
		{"malformed", "{", "test-only-key", 400},
		{"null", "null", "test-only-key", 400},
		{"missing turn", `{"sobrevivienteId":"S-0001","nodoActual":"A"}`, "test-only-key", 400},
		{"wrong field casing", `{"sobrevivienteId":"S-0001","nodoActual":"A","Turno":1}`, "test-only-key", 400},
		{"wrong type", `{"sobrevivienteId":"S-0001","nodoActual":"A","turno":"1"}`, "test-only-key", 400},
		{"negative turn", `{"sobrevivienteId":"S-0001","nodoActual":"A","turno":-1}`, "test-only-key", 400},
		{"unknown property", `{"sobrevivienteId":"S-0001","nodoActual":"A","turno":1,"key":"private"}`, "test-only-key", 400},
		{"trailing JSON", validBody + "{}", "test-only-key", 400},
		{"unknown survivor", `{"sobrevivienteId":"missing","nodoActual":"A","turno":1}`, "test-only-key", 404},
		{"unknown node", `{"sobrevivienteId":"S-0001","nodoActual":"missing","turno":1}`, "test-only-key", 404},
		{"wrong node", `{"sobrevivienteId":"S-0001","nodoActual":"B","turno":1}`, "test-only-key", 409},
		{"stale turn", `{"sobrevivienteId":"S-0001","nodoActual":"A","turno":0}`, "test-only-key", 409},
	} {
		t.Run(tt.name, func(t *testing.T) {
			response := invoke(h, tt.body, tt.key)
			if response.Code != tt.status {
				t.Fatalf("status %d: %s", response.Code, response.Body)
			}
			var body map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if tt.status == 200 {
				if len(body) != 1 || body["siguienteNodo"] != "B" {
					t.Fatalf("wrong exact response: %v", body)
				}
			} else {
				e, ok := body["error"].(map[string]any)
				if !ok || e["requestId"] != response.Header().Get("x-request-id") {
					t.Fatalf("missing error envelope: %v", body)
				}
				if bytes.Contains(response.Body.Bytes(), []byte("test-only-key")) {
					t.Fatal("key exposed")
				}
			}
		})
	}
	before, _ := store.Load()
	if before.Survivors[0].CurrentNode != "A" {
		t.Fatal("decision mutated authoritative state")
	}
}

func TestUnavailableInactiveAndInvalidDecision(t *testing.T) {
	store := world.NewStore()
	choice := "B"
	h := build(t, store, engineFunc(func(context.Context, world.WorldSnapshot, world.Survivor) world.DecisionResult {
		return world.DecisionResult{NextNode: choice}
	}), 0)
	if response := invoke(h, validBody, "test-only-key"); response.Code != 503 {
		t.Fatal(response.Code)
	}
	_, w := fixture()
	w.Survivors[0].Status = world.Evacuated
	store.Publish(w)
	if response := invoke(h, validBody, "test-only-key"); response.Code != 409 {
		t.Fatal(response.Code)
	}
	w.Survivors[0].Status = world.Active
	w.BlockedEdges = []string{"AB"}
	store.Publish(w)
	if response := invoke(h, validBody, "test-only-key"); response.Body.String() != "{\"siguienteNodo\":\"A\"}\n" {
		t.Fatal(response.Body)
	}
	w.BlockedEdges = nil
	store.Publish(w)
	choice = "C"
	if response := invoke(h, validBody, "test-only-key"); response.Body.String() != "{\"siguienteNodo\":\"A\"}\n" {
		t.Fatal("nonadjacent move approved", response.Body)
	}
}

func TestContextDeadlineAndCancellation(t *testing.T) {
	store := world.NewStore()
	_, w := fixture()
	store.Publish(w)
	h := build(t, store, engineFunc(func(ctx context.Context, _ world.WorldSnapshot, _ world.Survivor) world.DecisionResult {
		<-ctx.Done()
		return world.DecisionResult{NextNode: "B"}
	}), 5*time.Millisecond)
	started := time.Now()
	response := invoke(h, validBody, "test-only-key")
	if response.Code != 504 || time.Since(started) > 500*time.Millisecond {
		t.Fatalf("timeout failed: %d", response.Code)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := httptest.NewRequest("POST", "/paso", bytes.NewBufferString(validBody)).WithContext(ctx)
	r.Header.Set("x-api-key", "test-only-key")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if rec.Code != 504 {
		t.Fatal(rec.Code)
	}
}

func TestSnapshotEndpointsAndMethods(t *testing.T) {
	store := world.NewStore()
	_, w := fixture()
	store.Publish(w)
	h := build(t, store, engineFunc(func(context.Context, world.WorldSnapshot, world.Survivor) world.DecisionResult {
		return world.DecisionResult{NextNode: "B"}
	}), 0)
	for _, tt := range []struct {
		method, path string
		status       int
	}{{"GET", "/estado", 200}, {"GET", "/grafo", 200}, {"GET", "/healthz", 200}, {"GET", "/paso", 405}, {"POST", "/estado", 405}, {"GET", "/unknown", 404}} {
		r := httptest.NewRequest(tt.method, tt.path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		if rec.Code != tt.status {
			t.Fatalf("%s %s: %d", tt.method, tt.path, rec.Code)
		}
		if tt.path == "/estado" && tt.method == "GET" && bytes.Contains(rec.Body.Bytes(), []byte(`"graph":`)) {
			t.Fatal("embedded graph leaked")
		}
	}
	r := httptest.NewRequest("OPTIONS", "/estado", nil)
	r.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatal("CORS failed")
	}
}

func TestConcurrentHTTPDoesNotMutateSnapshot(t *testing.T) {
	store := world.NewStore()
	_, w := fixture()
	store.Publish(w)
	h := build(t, store, engineFunc(func(_ context.Context, w world.WorldSnapshot, _ world.Survivor) world.DecisionResult {
		w.Survivors[0].CurrentNode = "C"
		return world.DecisionResult{NextNode: "B"}
	}), 0)
	server := httptest.NewServer(h)
	defer server.Close()
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req, _ := http.NewRequest("POST", server.URL+"/paso", bytes.NewBufferString(validBody))
			req.Header.Set("x-api-key", "test-only-key")
			resp, err := server.Client().Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			defer resp.Body.Close()
			_, _ = io.Copy(io.Discard, resp.Body)
			if resp.StatusCode != 200 {
				t.Error(resp.StatusCode)
			}
		}()
	}
	wg.Wait()
	after, _ := store.Load()
	if after.Survivors[0].CurrentNode != "A" {
		t.Fatal("shared snapshot mutated")
	}
}

func TestSlowRequestBodyHasAnHTTPDeadline(t *testing.T) {
	store := world.NewStore()
	_, snapshot := fixture()
	store.Publish(snapshot)
	h := build(t, store, engineFunc(func(context.Context, world.WorldSnapshot, world.Survivor) world.DecisionResult {
		return world.DecisionResult{NextNode: "B"}
	}), 30*time.Millisecond)
	server := httptest.NewServer(h)
	defer server.Close()
	connection, err := net.Dial("tcp", server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(time.Second))
	started := time.Now()
	// Declared body is deliberately incomplete; no final bytes ever arrive.
	_, err = io.WriteString(connection, "POST /paso HTTP/1.1\r\nHost: localhost\r\nx-api-key: test-only-key\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"sobrevivienteId\":")
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(connection), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 504 || time.Since(started) > 500*time.Millisecond {
		t.Fatalf("slow request escaped deadline: status=%d elapsed=%v", response.StatusCode, time.Since(started))
	}
	var envelope map[string]any
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if envelope["error"].(map[string]any)["code"] != "TIMEOUT" {
		t.Fatal(envelope)
	}
}

func TestHTTPRequiresCompetitionShelterCount(t *testing.T) {
	g, _ := fixture()
	g.Shelters = g.Shelters[:1]
	_, err := httpapi.New(world.NewStore(), engineFunc(func(context.Context, world.WorldSnapshot, world.Survivor) world.DecisionResult {
		return world.DecisionResult{}
	}), g, httpapi.Options{APIKey: "test-only-key"})
	if err == nil {
		t.Fatal("HTTP graph violates four-shelter schema")
	}
}
