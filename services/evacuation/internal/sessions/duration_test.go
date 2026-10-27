package sessions

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"corodev/evacuation/internal/runlimits"
)

func TestProductionDurationBoundsAndOfficialHTTP(t *testing.T) {
	m, _ := testManager(t, func(o *Options) { o.MinTicks = runlimits.MinTicks })
	server := httptest.NewServer(m)
	defer server.Close()
	for _, ticks := range []int{0, 1, 29, 3001} {
		code, _, _ := publishedRequest(t, server, "POST", "/v1/simulations", request(ticks), "", fmt.Sprintf("duration-invalid-%d", ticks), "")
		if code != 400 {
			t.Fatalf("accepted %d turns: HTTP %d", ticks, code)
		}
	}
	req := CreateRequest{Scenario: "zombie_outbreak", GraphProfile: "BASE", MaxTicks: pointer(300), Config: InputConfig{Mode: "official", Round: "round1"}}
	code, _, _ := publishedRequest(t, server, "POST", "/v1/simulations", req, "", "official-extended-invalid", "")
	if code != 400 {
		t.Fatalf("extended official accepted: HTTP %d", code)
	}
	req.MaxTicks = nil
	code, raw, _ := publishedRequest(t, server, "POST", "/v1/simulations", req, "", "official-duration-valid", "")
	var info Metadata
	if code != 201 || json.Unmarshal(raw, &info) != nil || info.MaxTicks != runlimits.OfficialTicks || info.TickIntervalMS != 2000 || info.Config.Survivors != 20 {
		t.Fatalf("official changed: HTTP %d %s", code, raw)
	}
	_, _ = m.Control(info.SimulationID, info.AccessToken, "cancel")
	defaults := DefaultOptions()
	if defaults.MaxWallTime < time.Duration(runlimits.MaxTicks)*5*time.Second {
		t.Fatal("default wall limit cuts off supported runs")
	}
}

func TestLongZombieRunsCompleteAtConfiguredHorizonAndReplay(t *testing.T) {
	m, _ := testManager(t, func(o *Options) { o.MinTicks = runlimits.MinTicks; o.MaxRetained = 32 })
	for _, ticks := range []int{30, 150, 300, 600, 1200, 3000} {
		t.Run(fmt.Sprint(ticks), func(t *testing.T) {
			var previous State
			for replay := 0; replay < 2; replay++ {
				req := request(ticks)
				req.Config.Survivors = pointer(1)
				req.Config.Pro = &ProInput{RunnerPrediction: pointer(false)}
				info := create(t, m, req, fmt.Sprintf("long-%04d-replay-%d", ticks, replay))
				run, err := m.lookup(info.SimulationID, info.AccessToken, false)
				if err != nil {
					t.Fatal(err)
				}
				// The fake timer stays still; exercise the exact session writer and its
				// authenticated loopback HTTP decisions without waiting 100 minutes.
				for turn := 1; turn <= ticks; turn++ {
					if replay == 1 && turn == ticks/2 {
						if _, err = m.Control(info.SimulationID, info.AccessToken, "pause"); err != nil {
							t.Fatal(err)
						}
						if _, performed := m.advanceTurn(run); performed {
							t.Fatal("paused writer advanced")
						}
						if _, err = m.Control(info.SimulationID, info.AccessToken, "resume"); err != nil {
							t.Fatal(err)
						}
					}
					current, performed := m.advanceTurn(run)
					if !performed || current.Tick != turn || turn < ticks && current.Status != Running || turn == ticks && current.Status != Completed {
						t.Fatalf("horizon %d prematurely stopped at %+v", ticks, current)
					}
				}
				select {
				case run.wake <- struct{}{}:
				default:
				}
				<-run.done
				final := state(t, m, info)
				if final.Snapshot.Graph != nil || len(final.Snapshot.Survivors) != 1 || final.Snapshot.Metrics.RequestsInvalid != 0 || final.Snapshot.Metrics.RequestsTimeout != 0 {
					t.Fatal("invalid long snapshot or HTTP decision")
				}
				if replay == 1 && !reflect.DeepEqual(logical(final), logical(previous)) {
					t.Fatal("same seed or pause changed long outcome")
				}
				previous = final
			}
		})
	}
}

func TestCustomFloodSessionHonorsExtendedHorizon(t *testing.T) {
	m, _ := testManager(t, nil)
	req := request(600)
	req.Scenario = "urban_flood"
	run, err := m.prepare(req)
	if err != nil {
		t.Fatal(err)
	}
	defer run.cancel()
	defer run.app.Close()
	if run.info.MaxTicks != 600 || run.snapshot.Scenario.SimulationDuration != 600 {
		t.Fatal("flood session retained fixed 150-turn clock")
	}
	if _, err = m.CreateAndStart(context.Background(), CreateRequest{Scenario: "zombie_outbreak", GraphProfile: "BASE", MaxTicks: pointer(3000), Config: InputConfig{Mode: "official"}}, "official-three-thousand", "test"); err == nil {
		t.Fatal("official upper bound bypassed")
	}
}
