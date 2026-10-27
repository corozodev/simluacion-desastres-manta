package floodlab

import (
	"context"
	"corodev/evacuation/internal/reference"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func managerReference(t *testing.T, m *Manager) *reference.Service {
	t.Helper()
	s := reference.New("", "../../data/reference/manta-official.json", false)
	t.Cleanup(s.Close)
	if e := m.SetReferenceService(s); e != nil {
		t.Fatal(e)
	}
	return s
}
func TestOfficialReferenceRemainsContextualAndPinned(t *testing.T) {
	m := newManager(t)
	s := managerReference(t, m)
	cfg := compactConfig(m)
	cfg.Seed = 42
	plain, e := m.prepare(cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer plain.app.Close()
	cfg.GeographicReference = &GeographicReference{Enabled: true, DatasetVersion: s.Status().DatasetVersion, Strength: .8}
	hybrid, e := m.prepare(cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer hybrid.app.Close()
	if !reflect.DeepEqual(plain.origins, hybrid.origins) {
		t.Fatal("reference changed origins")
	}
	use := hybrid.app.Simulator.Snapshot().Scenario.DataProvenance.GeographicReference
	if use == nil || use.DatasetVersion != cfg.GeographicReference.DatasetVersion || len(use.Zones) != 0 {
		t.Fatal("version absent or contextual reference changed hydraulic terrain", use)
	}
	for i := 0; i < int(cfg.SimulationDuration); i++ {
		if e = plain.app.Simulator.Step(context.Background()); e != nil {
			t.Fatal(e)
		}
		if e = hybrid.app.Simulator.Step(context.Background()); e != nil {
			t.Fatal(e)
		}
	}
	a, b := plain.app.Simulator.Snapshot(), hybrid.app.Simulator.Snapshot()
	if !reflect.DeepEqual(a.Survivors, b.Survivors) || !reflect.DeepEqual(a.Shelters, b.Shelters) || !reflect.DeepEqual(a.Scenario.EvacuationMetrics, b.Scenario.EvacuationMetrics) {
		t.Fatal("contextual susceptibility altered hydraulic outcomes")
	}
	cfg.GeographicReference.DatasetVersion = "missing-version"
	if _, e = m.prepare(cfg); e == nil {
		t.Fatal("silently changed reference version")
	}
	cfg.GeographicReference = nil
	again, e := m.prepare(cfg)
	if e != nil {
		t.Fatal("synthetic became dependent on source", e)
	}
	_ = again.app.Close()
}

func TestReferencePublicHTTPIsOfflineAndRefreshProtected(t *testing.T) {
	m := newManager(t)
	s := managerReference(t, m)
	server := httptest.NewServer(m)
	defer server.Close()
	client := server.Client()
	get := func(path string) (*http.Response, json.RawMessage) {
		t.Helper()
		res, e := client.Get(server.URL + path)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		var value json.RawMessage
		if e = json.NewDecoder(res.Body).Decode(&value); e != nil {
			t.Fatal(e)
		}
		return res, value
	}
	res, raw := get("/v1/reference/status")
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	var status reference.Status
	_ = json.Unmarshal(raw, &status)
	if status.Mode != "offline" || status.FeatureCount != 59 {
		t.Fatal(status)
	}
	res, raw = get("/v1/reference/susceptibility?version=" + status.DatasetVersion)
	var c reference.Collection
	_ = json.Unmarshal(raw, &c)
	if res.StatusCode != 200 || c.FeatureCount != 59 || res.Header.Get("ETag") == "" {
		t.Fatal("offline polygons absent")
	}
	req, _ := http.NewRequest("GET", server.URL+"/v1/reference/susceptibility?version="+status.DatasetVersion, nil)
	req.Header.Set("If-None-Match", res.Header.Get("ETag"))
	cached, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	_ = cached.Body.Close()
	if cached.StatusCode != 304 {
		t.Fatal("ETag not honored")
	}
	res, _ = get("/v1/reference/susceptibility?bbox=-180,-90,180,90")
	if res.StatusCode != 400 {
		t.Fatal("national query accepted")
	}
	res, _ = get("/v1/reference/rain-events")
	if res.StatusCode != 200 {
		t.Fatal("history unavailable")
	}
	res, _ = get("/lab/telemetry")
	if res.StatusCode != 200 {
		t.Fatal("telemetry unavailable")
	}
	req, _ = http.NewRequest("POST", server.URL+"/lab/reference/refresh", nil)
	req.Header.Set("Origin", testOrigin)
	blocked, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	_ = blocked.Body.Close()
	if blocked.StatusCode != 401 {
		t.Fatal("public privileged refresh")
	}
	if s.Status().Metrics.Queries != 0 {
		t.Fatal("HTTP read contacted provider")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestSlowOfficialProviderDoesNotBlockSimulation(t *testing.T) {
	m := newManager(t)
	c := reference.NewClient()
	started := make(chan struct{}, 1)
	c.HTTP = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		select {
		case started <- struct{}{}:
		default:
		}
		<-r.Context().Done()
		return nil, r.Context().Err()
	})}
	s := reference.New("", "../../data/reference/manta-official.json", true, c)
	defer s.Close()
	if e := m.SetReferenceService(s); e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Refresh(ctx)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("provider did not start")
	}
	cfg := compactConfig(m)
	cfg.IntervalMS = 1
	state, e := m.Start(RunRequest{Config: cfg, ExpectedRunID: m.State().RunID})
	if e != nil {
		t.Fatal(e)
	}
	state = waitState(t, m, func(s State) bool { return s.Scenario.SimulationStep >= 2 })
	if !s.Status().Refreshing || state.Scenario.SimulationStep < 2 {
		t.Fatal("source latency blocked engine")
	}
	cancel()
}
