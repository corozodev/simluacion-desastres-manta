package application_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"reflect"
	"testing"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

func runHTTPScenario(t *testing.T) world.WorldSnapshot {
	t.Helper()
	g, err := graph.Load("../../data/manta.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := simulation.LoadConfig("../../scenarios/round3.json")
	if err != nil {
		t.Fatal(err)
	}
	key, err := application.EphemeralKey()
	if err != nil {
		t.Fatal(err)
	}
	app, err := application.New(g, cfg, "127.0.0.1:0", key, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	if err := app.Simulator.Run(context.Background(), cfg.Turns, 0); err != nil {
		t.Fatal(err)
	}
	response, err := http.Get(app.BaseURL + "/estado")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("GET /estado: %d", response.StatusCode)
	}
	var public world.WorldSnapshot
	if err := json.NewDecoder(response.Body).Decode(&public); err != nil {
		t.Fatal(err)
	}
	if public.Turn != 150 || len(public.Survivors) != 200 || public.Metrics.RequestsSuccess == 0 {
		t.Fatalf("incomplete real HTTP simulation: %+v", public.Metrics)
	}
	if public.Metrics.RequestsInvalid != 0 || public.Metrics.RequestsTimeout != 0 {
		t.Fatalf("failed decision requests: %+v", public.Metrics)
	}
	if public.Metrics.Active+public.Metrics.Bitten+public.Metrics.Evacuated != 200 {
		t.Fatal("survivor conservation failed")
	}
	if len(public.BlockedEdges) != 2 {
		t.Fatal("scheduled round3 closures were not preserved")
	}
	for _, z := range public.Zombies {
		if z.Type == world.Sleeper && !z.Awake {
			t.Fatal("hidden sleeper published")
		}
	}
	if public.Graph != nil {
		t.Fatal("graph embedded in public state")
	}
	return public
}

func TestRealHTTP200SurvivorsAndSeedDeterminism(t *testing.T) {
	a, b := runHTTPScenario(t), runHTTPScenario(t)
	// Transport timings are measured separately and inherently vary. Decisions,
	// outcomes, event order and request counts must reproduce for the same seed.
	a.Metrics.HTTPP50MS, a.Metrics.HTTPP95MS, a.Metrics.HTTPP99MS = 0, 0, 0
	b.Metrics.HTTPP50MS, b.Metrics.HTTPP95MS, b.Metrics.HTTPP99MS = 0, 0, 0
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("same-seed HTTP runs produced different world state")
	}
}

func TestIPv4WildcardAdvertisesWorkingSelfHTTP(t *testing.T) {
	g, err := graph.Load("../../data/manta-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := simulation.LoadConfig("../../scenarios/urban/round1.json")
	if err != nil {
		t.Fatal(err)
	}
	key, err := application.EphemeralKey()
	if err != nil {
		t.Fatal(err)
	}
	app, err := application.New(g, cfg, "0.0.0.0:0", key, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	address, err := url.Parse(app.BaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if address.Hostname() != "127.0.0.1" {
		t.Fatalf("IPv4 bind advertised an incompatible loopback: %s", app.BaseURL)
	}
	if err := app.Simulator.Step(context.Background()); err != nil {
		t.Fatal(err)
	}
	m := app.Simulator.Snapshot().Metrics
	if m.RequestsSuccess != 20 || m.RequestsInvalid != 0 || m.RequestsTimeout != 0 {
		t.Fatalf("self HTTP failed: %+v", m)
	}
}

func TestCloseIsConcurrentAndIdempotent(t *testing.T) {
	g, err := graph.Load("../../data/manta-v2.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := simulation.LoadConfig("../../scenarios/urban/round1.json")
	if err != nil {
		t.Fatal(err)
	}
	key, err := application.EphemeralKey()
	if err != nil {
		t.Fatal(err)
	}
	app, err := application.New(g, cfg, "127.0.0.1:0", key, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Simulator.Step(context.Background()); err != nil {
		_ = app.Close()
		t.Fatal(err)
	}
	const callers = 32
	start := make(chan struct{})
	results := make(chan error, callers)
	for i := 0; i < callers; i++ {
		go func() {
			<-start
			results <- app.Close()
		}()
	}
	close(start)
	deadline := time.NewTimer(7 * time.Second)
	defer deadline.Stop()
	for i := 0; i < callers; i++ {
		select {
		case err := <-results:
			if err != nil {
				t.Fatal(err)
			}
		case <-deadline.C:
			t.Fatal("repeated cleanup blocked after the HTTP server had stopped")
		}
	}
	client := &http.Client{Timeout: time.Second}
	response, err := client.Get(app.BaseURL + "/healthz")
	if err == nil {
		_ = response.Body.Close()
		t.Fatal("closed application left its HTTP listener available")
	}
	if app.Simulator.Snapshot().Turn != 1 {
		t.Fatal("cleanup discarded the observable final world")
	}
}
