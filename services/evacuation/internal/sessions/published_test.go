package sessions

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"
)

func publishedRequest(t testing.TB, server *httptest.Server, method, path string, body any, token, key, etag string) (int, []byte, http.Header) {
	t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, err := http.NewRequest(method, server.URL+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("If-None-Match", etag)
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err = io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, raw, response.Header
}

func TestPublishedHTTPJoinPauseFinalAndReplacement(t *testing.T) {
	m, clock := testManager(t, func(o *Options) { o.MaxActive = 3 })
	server := httptest.NewServer(m)
	defer server.Close()
	path := "/v1/simulations/published/zombie_outbreak"
	code, raw, _ := publishedRequest(t, server, "GET", path, nil, "", "", "")
	if code != 200 || string(raw) != "{\"scenario\":\"zombie_outbreak\",\"availability\":\"none\"}\n" || m.Stats().Retained != 0 {
		t.Fatal("observation started an execution", code, string(raw))
	}
	code, raw, _ = publishedRequest(t, server, "POST", "/v1/simulations", request(4), "", "published-http-create-key", "")
	var created Metadata
	if code != 201 || json.Unmarshal(raw, &created) != nil {
		t.Fatal("explicit creation failed", code, string(raw))
	}
	for tick := 1; tick <= 3; tick++ {
		advance(t, m, clock, created, tick)
	}
	code, raw, headers := publishedRequest(t, server, "GET", path, nil, "", "", "")
	var publication Published
	if code != 200 || json.Unmarshal(raw, &publication) != nil || publication.Availability != "available" || publication.Simulation == nil || publication.Simulation.Tick != 3 || publication.Simulation.SimulationID != created.SimulationID {
		t.Fatal("late spectator did not join current existing state", code, string(raw))
	}
	if bytes.Contains(raw, []byte(created.AccessToken)) || bytes.Contains(raw, []byte("access_token")) || bytes.Contains(raw, []byte(`"graph":`)) {
		t.Fatal("private credential or static geography leaked")
	}
	for _, z := range publication.Simulation.Snapshot.Zombies {
		if z.Type == "sleeper" && !z.Awake {
			t.Fatal("dormant sleeper leaked")
		}
	}
	before := m.Stats()
	var wg sync.WaitGroup
	for spectator := 0; spectator < 50; spectator++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, payload, _ := publishedRequest(t, server, "GET", path, nil, "", "", headers.Get("ETag"))
			if code != 304 || len(payload) != 0 {
				t.Errorf("unchanged cached snapshot was retransmitted: %d", code)
			}
		}()
	}
	wg.Wait()
	if after := m.Stats(); after.Active != before.Active || after.Retained != before.Retained || after.Turns != before.Turns {
		t.Fatal("spectators changed authoritative work", before, after)
	}
	code, _, _ = publishedRequest(t, server, "POST", "/v1/simulations/"+created.SimulationID+"/pause", nil, created.AccessToken, "", "")
	if code != 200 {
		t.Fatal("controller pause failed", code)
	}
	_, raw, pausedHeaders := publishedRequest(t, server, "GET", path, nil, "", "", "")
	if json.Unmarshal(raw, &publication) != nil || publication.Simulation.Status != Paused || pausedHeaders.Get("ETag") == headers.Get("ETag") {
		t.Fatal("pause was not published")
	}
	code, _, _ = publishedRequest(t, server, "POST", "/v1/simulations/"+created.SimulationID+"/resume", nil, created.AccessToken, "", "")
	if code != 200 {
		t.Fatal("resume failed")
	}
	advance(t, m, clock, created, 4)
	_, raw, _ = publishedRequest(t, server, "GET", path, nil, "", "", "")
	if json.Unmarshal(raw, &publication) != nil || publication.Simulation.Status != Completed || publication.Simulation.Results == nil || publication.Simulation.Tick != 4 {
		t.Fatal("final result was not preserved", string(raw))
	}
	flood := request(4)
	flood.Scenario = "urban_flood"
	f := create(t, m, flood, "published-independent-flood-key")
	_, raw, _ = publishedRequest(t, server, "GET", path, nil, "", "", "")
	if json.Unmarshal(raw, &publication) != nil || publication.Simulation.SimulationID != created.SimulationID {
		t.Fatal("flood publication replaced zombie reference")
	}
	_, raw, _ = publishedRequest(t, server, "GET", "/v1/simulations/published/urban_flood", nil, "", "", "")
	if json.Unmarshal(raw, &publication) != nil || publication.Simulation.SimulationID != f.SimulationID {
		t.Fatal("scenario publication is not independent")
	}
	next := create(t, m, request(4), "published-replacement-key")
	_, raw, _ = publishedRequest(t, server, "GET", path, nil, "", "", "")
	if json.Unmarshal(raw, &publication) != nil || publication.Simulation.SimulationID != next.SimulationID || publication.Simulation.Tick != 0 {
		t.Fatal("new run was mixed with old snapshot")
	}
	_, err := m.CreateAndStart(context.Background(), request(4), "published-http-create-key", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	_, raw, _ = publishedRequest(t, server, "GET", path, nil, "", "", "")
	if json.Unmarshal(raw, &publication) != nil || publication.Simulation.SimulationID != next.SimulationID {
		t.Fatal("idempotent replay republished an old execution")
	}
	code, _, _ = publishedRequest(t, server, "GET", "/v1/simulations/"+next.SimulationID+"/state", nil, "", "", "")
	if code != 401 {
		t.Fatal("public observation removed private control protection")
	}
	for _, method := range []string{"POST", "DELETE"} {
		code, _, _ = publishedRequest(t, server, method, path, nil, "", "", "")
		if code != 405 {
			t.Fatal("published reference accepted writes", method, code)
		}
	}
}

func TestPublishedHTTPLateJoinAtTurn80DoesNotReplay(t *testing.T) {
	m, clock := testManager(t, nil)
	server := httptest.NewServer(m)
	defer server.Close()
	code, raw, _ := publishedRequest(t, server, "POST", "/v1/simulations", request(150), "", "late-join-turn-eighty", "")
	var created Metadata
	if code != http.StatusCreated || json.Unmarshal(raw, &created) != nil {
		t.Fatal("creation failed", code)
	}
	// The clock accelerates scheduling only. Every turn uses the real engine
	// and its authenticated loopback HTTP decision client.
	for tick := 1; tick <= 80; tick++ {
		advance(t, m, clock, created, tick)
	}
	before := m.Stats()
	code, raw, headers := publishedRequest(t, server, "GET", "/v1/simulations/published/zombie_outbreak", nil, "", "", "")
	var current Published
	if code != http.StatusOK || json.Unmarshal(raw, &current) != nil || current.Simulation == nil || current.Simulation.Tick != 80 || current.Simulation.Snapshot.Turn != 80 || current.Simulation.SimulationID != created.SimulationID {
		t.Fatal("spectator did not receive the current turn directly", code)
	}
	if headers.Get("ETag") == "" || bytes.Contains(raw, []byte(created.AccessToken)) {
		t.Fatal("invalid public snapshot")
	}
	if after := m.Stats(); after.Turns != before.Turns || after.Active != before.Active || after.Retained != before.Retained {
		t.Fatal("late join replayed work or created another engine")
	}
}

func TestPublishedReadersNeverExtendLease(t *testing.T) {
	m, clock := testManager(t, func(o *Options) { o.IdleTTL = 5 * time.Second })
	server := httptest.NewServer(m)
	defer server.Close()
	i := create(t, m, request(10), "published-expiry-test-key")
	path := "/v1/simulations/published/zombie_outbreak"
	for second := 0; second < 6; second++ {
		publishedRequest(t, server, "GET", path, nil, "", "", "")
		clock.Advance(time.Second)
	}
	m.Cleanup()
	code, raw, _ := publishedRequest(t, server, "GET", path, nil, "", "", "")
	var publication Published
	if code != 200 || json.Unmarshal(raw, &publication) != nil || publication.Availability != "unavailable" || publication.Simulation != nil {
		t.Fatal("expired snapshot was presented as current", code, string(raw))
	}
	_, err := m.Get(i.SimulationID, i.AccessToken)
	expectError(t, err, 410)
}

func TestPublishedSpectatorsDoNotAlterLogicalOutcomes(t *testing.T) {
	observed, ca := testManager(t, nil)
	baseline, cb := testManager(t, nil)
	server := httptest.NewServer(observed)
	defer server.Close()
	a := create(t, observed, request(5), "spectator-determinism-a")
	b := create(t, baseline, request(5), "spectator-determinism-b")
	for tick := 1; tick <= 5; tick++ {
		for spectator := 0; spectator < 10; spectator++ {
			code, _, _ := publishedRequest(t, server, "GET", "/v1/simulations/published/zombie_outbreak", nil, "", "", "")
			if code != 200 {
				t.Fatal(fmt.Sprintf("spectator %d failed: %d", spectator, code))
			}
		}
		advance(t, observed, ca, a, tick)
		advance(t, baseline, cb, b, tick)
	}
	x, y := state(t, observed, a).Snapshot, state(t, baseline, b).Snapshot
	if !reflect.DeepEqual(x.Survivors, y.Survivors) || !reflect.DeepEqual(x.Zombies, y.Zombies) || !reflect.DeepEqual(x.Shelters, y.Shelters) || x.Turn != y.Turn {
		t.Fatal("spectator traffic altered deterministic outcomes")
	}
}
