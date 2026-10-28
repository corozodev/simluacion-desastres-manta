package sessions

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"corodev/evacuation/internal/diagnostics"
	"corodev/evacuation/internal/simulation"
)

func postGeneration(t *testing.T, server *httptest.Server, body, key string, want int) Metadata {
	t.Helper()
	req, _ := http.NewRequest("POST", server.URL+"/v1/simulations", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != want {
		t.Fatalf("expected HTTP %d, got %d for %s", want, resp.StatusCode, body)
	}
	var info Metadata
	if want == 201 && json.NewDecoder(resp.Body).Decode(&info) != nil {
		t.Fatal("invalid creation metadata")
	}
	return info
}

func TestGenerationHTTPValidatesCompositionBeforeStarting(t *testing.T) {
	m, _ := testManager(t, func(o *Options) { o.CreateLimitPerMinute = 1000; o.RateLimitPerMinute = 1000 })
	server := httptest.NewServer(m)
	defer server.Close()
	for n, config := range []string{
		`{"round":"round1","zombie_counts":{"walker":2,"runner":1,"horde":0,"sleeper":0}}`,
		`{"round":"round1","zombie_counts":{"walker":0,"runner":0,"horde":0,"sleeper":0}}`,
		`{"round":"round2","zombie_counts":{"walker":2,"runner":0,"horde":1,"sleeper":0}}`,
		`{"round":"round2","zombie_counts":{"walker":2,"runner":1,"horde":0,"sleeper":0}}`,
		`{"round":"round2","zombie_counts":{"walker":2,"runner":1,"horde":1,"sleeper":1}}`,
		`{"round":"round3","zombie_counts":{"walker":2,"runner":1,"horde":1,"sleeper":0}}`,
		`{"zombie_counts":{"walker":-1,"runner":0,"horde":0,"sleeper":0}}`,
		`{"zombie_counts":{"walker":1.5,"runner":0,"horde":0,"sleeper":0}}`,
		`{"zombie_counts":{"walker":"2","runner":0,"horde":0,"sleeper":0}}`,
		`{"zombie_counts":{"walker":null,"runner":0,"horde":0,"sleeper":0}}`,
		`{"zombie_counts":{"walker":2,"runner":0,"horde":0}}`,
		`{"zombie_counts":{"walker":2,"runner":0,"horde":0,"sleeper":0,"hidden":1}}`,
		`{"zombie_counts":null}`, `{"zombie_counts":[]}`,
		`{"zombie_counts":{"walker":9007199254740992,"runner":0,"horde":0,"sleeper":0}}`,
		`{"zombie_counts":{"walker":9007199254740991,"runner":0,"horde":0,"sleeper":0}}`,
	} {
		for _, mode := range []string{"official", "experimental"} {
			config = strings.Replace(config, "{", `{"mode":"`+mode+`",`, 1)
			postGeneration(t, server, `{"scenario":"zombie_outbreak","graph_profile":"BASE","config":`+config+`}`, fmt.Sprintf("invalid-generation-%d-%s", n, mode), 400)
			config = strings.Replace(config, `"mode":"`+mode+`",`, "", 1)
		}
	}
	postGeneration(t, server, `{"scenario":"urban_flood","graph_profile":"BASE","config":{"zombie_counts":{"walker":1,"runner":0,"horde":0,"sleeper":0}}}`, "invalid-flood-counts", 400)
	if m.Stats().Active != 0 || m.Stats().EstimatedMemoryBytes != 0 {
		t.Fatal("invalid requests allocated an execution")
	}
}

func initialGeneration(t *testing.T, m *Manager, i Metadata) diagnostics.Report {
	t.Helper()
	run, err := m.lookup(i.SimulationID, i.AccessToken, false)
	if err != nil {
		t.Fatal(err)
	}
	return run.app.Simulator.Diagnostics()
}

func TestGenerationExactCountsDefaultsAndPrivateSleepersOverHTTP(t *testing.T) {
	m, _ := testManager(t, func(o *Options) { o.CreateLimitPerMinute = 1000 })
	server := httptest.NewServer(m)
	defer server.Close()
	for n, counts := range []simulation.ZombieCounts{{Walker: 9}, {Walker: 13, Runner: 5, Horde: 3}, {Walker: 21, Runner: 9, Horde: 4, Sleeper: 11}} {
		raw, _ := json.Marshal(counts)
		body := fmt.Sprintf(`{"scenario":"zombie_outbreak","graph_profile":"BASE","seed":0,"config":{"mode":"official","round":"round%d","zombie_counts":%s}}`, n+1, raw)
		i := postGeneration(t, server, body, fmt.Sprintf("generation-valid-%d", n), 201)
		if i.Seed != 0 || i.Config.ZombieCounts == nil || *i.Config.ZombieCounts != counts || i.Config.Survivors != []int{20, 80, 200}[n] {
			t.Fatal("effective configuration differs")
		}
		d := initialGeneration(t, m, i)
		actual := map[string]int{}
		for _, z := range d.InitialZombies {
			actual[z.Type]++
		}
		if actual["walker"] != counts.Walker || actual["runner"] != counts.Runner || actual["horde"] != counts.Horde || actual["sleeper"] != counts.Sleeper || int64(len(d.InitialZombies)) != counts.Total() {
			t.Fatal("spawn counts differ")
		}
		for _, z := range state(t, m, i).Snapshot.Zombies {
			if z.Type == "sleeper" {
				t.Fatal("hidden sleeper published")
			}
		}
		// A returned pointer must never mutate the active composition.
		i.Config.ZombieCounts.Walker = 999
		got, _ := m.Get(i.SimulationID, i.AccessToken)
		if got.Config.ZombieCounts.Walker != counts.Walker {
			t.Fatal("mutable generation metadata")
		}
		_, _ = m.Control(i.SimulationID, i.AccessToken, "cancel")
	}
	for n, defaults := range []simulation.ZombieCounts{{Walker: 8}, {Walker: 12, Runner: 4, Horde: 2}, {Walker: 20, Runner: 8, Horde: 3, Sleeper: 10}} {
		body := fmt.Sprintf(`{"scenario":"zombie_outbreak","graph_profile":"BASE","config":{"round":"round%d"}}`, n+1)
		i := postGeneration(t, server, body, fmt.Sprintf("legacy-generation-%d", n), 201)
		if i.Config.ZombieCounts == nil || *i.Config.ZombieCounts != defaults || i.Seed < 0 || i.Seed > maxSafeInteger {
			t.Fatal("legacy defaults or automatic seed missing")
		}
		_, _ = m.Control(i.SimulationID, i.AccessToken, "cancel")
	}
}

func TestGenerationAutomaticSeedIdempotencyRestartAndPauseReplay(t *testing.T) {
	m, clock := testManager(t, nil)
	req := request(3)
	req.Seed = nil
	req.Config.Round = "round3"
	req.Config.ZombieCounts = &simulation.ZombieCounts{Walker: 7, Runner: 2, Horde: 1, Sleeper: 3}
	a := create(t, m, req, "generation-auto-seed")
	original := initialGeneration(t, m, a)
	replay := create(t, m, req, "generation-auto-seed")
	if a.SimulationID != replay.SimulationID || a.Seed != replay.Seed {
		t.Fatal("idempotency regenerated seed")
	}
	req.Seed = &a.Seed
	b := create(t, m, req, "generation-explicit-seed")
	bInitial := initialGeneration(t, m, b)
	if !reflect.DeepEqual(original.InitialSurvivors, bInitial.InitialSurvivors) || !reflect.DeepEqual(original.InitialZombies, bInitial.InitialZombies) {
		t.Fatal("same seed changed initial generation")
	}
	_, _ = m.Control(b.SimulationID, b.AccessToken, "pause")
	for tick := 1; tick <= 3; tick++ {
		advance(t, m, clock, a, tick)
	}
	await(t, func() bool { return m.Stats().Active == 1 })
	_, _ = m.Control(b.SimulationID, b.AccessToken, "resume")
	for tick := 1; tick <= 3; tick++ {
		advance(t, m, clock, b, tick)
	}
	if !reflect.DeepEqual(logical(state(t, m, a)), logical(state(t, m, b))) {
		t.Fatal("pause or concurrency changed seeded outcome")
	}
	_, _ = m.Control(b.SimulationID, b.AccessToken, "cancel") // already terminal; restart also waits for release
	c, err := m.Restart(context.Background(), b.SimulationID, b.AccessToken, "generation-restart-key", "test-ip")
	if err != nil {
		t.Fatal(err)
	}
	cInitial := initialGeneration(t, m, c)
	if c.SimulationID == b.SimulationID || c.Seed != b.Seed || !reflect.DeepEqual(c.Config, b.Config) || !reflect.DeepEqual(original.InitialZombies, cInitial.InitialZombies) {
		t.Fatal("restart lost generation configuration")
	}
	_, _ = m.Control(c.SimulationID, c.AccessToken, "cancel")
	req.Seed = nil
	d := create(t, m, req, "generation-fresh-seed")
	if d.Seed == a.Seed {
		t.Fatal("new creation reused automatic seed")
	}
}

func TestGenerationMemoryReservationIncludesRetainedPopulation(t *testing.T) {
	m, _ := testManager(t, func(o *Options) { o.MaxMemoryBytes = baseReservation + 4*zombieReservation })
	r := request(3)
	r.Config.ZombieCounts = &simulation.ZombieCounts{Walker: 12}
	a := create(t, m, r, "generation-memory-key")
	if m.Stats().EstimatedMemoryBytes != baseReservation+4*zombieReservation {
		t.Fatal("extra zombies unaccounted")
	}
	_, _ = m.Control(a.SimulationID, a.AccessToken, "cancel")
	if m.Stats().EstimatedMemoryBytes != 1<<20+4*zombieReservation {
		t.Fatal("retained population unaccounted")
	}
	r.Config.ZombieCounts.Walker = 13
	_, err := m.CreateAndStart(context.Background(), r, "generation-too-many", "test-ip")
	expectError(t, err, 400)
}
