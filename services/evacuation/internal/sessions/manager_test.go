package sessions

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/world"
)

type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
}
type fakeTimer struct {
	clock    *fakeClock
	due      time.Time
	duration time.Duration
	channel  chan time.Time
	stopped  bool
}

func newClock() *fakeClock          { return &fakeClock{now: time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)} }
func (c *fakeClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *fakeClock) NewTimer(d time.Duration) Timer {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{clock: c, due: c.now.Add(d), duration: d, channel: make(chan time.Time, 1)}
	if d <= 0 {
		t.stopped = true
		t.channel <- c.now
		return t
	}
	c.timers = append(c.timers, t)
	return t
}
func (t *fakeTimer) C() <-chan time.Time { return t.channel }
func (t *fakeTimer) Stop() bool {
	t.clock.mu.Lock()
	defer t.clock.mu.Unlock()
	was := !t.stopped
	t.stopped = true
	return was
}
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
	pending := c.timers[:0]
	for _, t := range c.timers {
		if !t.stopped && !c.now.Before(t.due) {
			t.stopped = true
			t.channel <- c.now
		}
		if !t.stopped {
			pending = append(pending, t)
		}
	}
	c.timers = pending
}
func (c *fakeClock) count(d time.Duration) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, t := range c.timers {
		if !t.stopped && t.duration == d {
			n++
		}
	}
	return n
}

var fixtureOnce sync.Once
var fixtureCatalog *catalog.Catalog
var fixtureErr error

func testCatalog(t testing.TB) *catalog.Catalog {
	t.Helper()
	fixtureOnce.Do(func() {
		fixtureCatalog, fixtureErr = catalog.New("../../data", "../../scenarios/urban", catalog.Options{EnableFull: true, Concurrency: 16})
	})
	if fixtureErr != nil {
		t.Fatal(fixtureErr)
	}
	return fixtureCatalog
}
func testManager(t testing.TB, change func(*Options)) (*Manager, *fakeClock) {
	t.Helper()
	clock := newClock()
	o := DefaultOptions()
	o.Clock = clock
	if change != nil {
		change(&o)
	}
	m, err := New(testCatalog(t), o)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close() })
	return m, clock
}
func pointer[T any](v T) *T { return &v }
func request(ticks int) CreateRequest {
	return CreateRequest{Scenario: "zombie_outbreak", GraphProfile: "BASE", Seed: pointer(int64(42)), MaxTicks: pointer(ticks), Config: InputConfig{Survivors: pointer(8)}}
}
func create(t testing.TB, m *Manager, r CreateRequest, key string) Metadata {
	t.Helper()
	i, err := m.CreateAndStart(context.Background(), r, key, "test-ip")
	if err != nil {
		t.Fatal(err)
	}
	return i
}
func await(t testing.TB, ready func() bool) {
	t.Helper()
	until := time.Now().Add(10 * time.Second)
	for !ready() {
		if time.Now().After(until) {
			t.Fatal("condition was not reached")
		}
		runtime.Gosched()
	}
}
func state(t testing.TB, m *Manager, i Metadata) State {
	t.Helper()
	s, err := m.GetSnapshot(i.SimulationID, i.AccessToken, false)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func advance(t testing.TB, m *Manager, c *fakeClock, i Metadata, target int) {
	t.Helper()
	await(t, func() bool { return c.count(2*time.Second) > 0 })
	c.Advance(2 * time.Second)
	await(t, func() bool { return state(t, m, i).Tick >= target })
}
func expectError(t testing.TB, err error, status int) {
	t.Helper()
	e, ok := err.(*Error)
	if !ok || e.Status != status {
		t.Fatalf("expected status %d, got %v", status, err)
	}
}

func TestNoAutostartAndIndependentPrivateState(t *testing.T) {
	m, c := testManager(t, nil)
	if v := m.Stats(); v.Active != 0 || v.Retained != 0 {
		t.Fatal(v)
	}
	c.Advance(time.Minute)
	if m.Stats().Turns != 0 {
		t.Fatal("clock advances must not start simulations")
	}
	a := create(t, m, request(3), "independent-key-a")
	b := create(t, m, request(3), "independent-key-b")
	if a.SimulationID == b.SimulationID || a.AccessToken == b.AccessToken || len(a.AccessToken) != 43 {
		t.Fatal("IDs and credentials must be independent")
	}
	sa, sb := state(t, m, a), state(t, m, b)
	if sa.Snapshot.Graph != nil || !reflect.DeepEqual(sa.Snapshot.Survivors, sb.Snapshot.Survivors) {
		t.Fatal("initial state is not reproducible or contains topology")
	}
	for _, z := range sa.Snapshot.Zombies {
		if z.Type == world.Sleeper && !z.Awake {
			t.Fatal("dormant sleeper escaped")
		}
	}
	sa.Snapshot.Survivors[0].CurrentNode = "tampered"
	sa.Config.RefugeIDs[0] = "tampered"
	sa.Snapshot.Shelters[0].Occupancy = 999
	if state(t, m, a).Snapshot.Survivors[0].CurrentNode == "tampered" || state(t, m, b).Snapshot.Shelters[0].Occupancy == 999 {
		t.Fatal("mutable state leaked")
	}
	_, err := m.Get(a.SimulationID, b.AccessToken)
	expectError(t, err, 401)
	_, err = m.GetSnapshot(a.SimulationID, a.AccessToken, true)
	expectError(t, err, 409)
	if m.Stats().Active != 2 {
		t.Fatal("missing reservations")
	}
}

func TestShelterComparisonsPreservePopulationAndThreatSeed(t *testing.T) {
	m, _ := testManager(t, nil)
	a := create(t, m, request(2), "shelter-default-key")
	r := request(2)
	r.Config.RefugeIDs = []string{a.Config.RefugeIDs[0]}
	b := create(t, m, r, "shelter-selected-key")
	sa, sb := state(t, m, a), state(t, m, b)
	for i := range sa.Snapshot.Survivors {
		sa.Snapshot.Survivors[i].PlannedRoute = nil
		sa.Snapshot.Survivors[i].TargetShelterID = ""
		sb.Snapshot.Survivors[i].PlannedRoute = nil
		sb.Snapshot.Survivors[i].TargetShelterID = ""
	}
	if !reflect.DeepEqual(sa.Snapshot.Survivors, sb.Snapshot.Survivors) || !reflect.DeepEqual(sa.Snapshot.Zombies, sb.Snapshot.Zombies) {
		t.Fatal("shelter choice must not change initial agents or threat RNG")
	}
	if len(sb.Snapshot.Shelters) != 1 {
		t.Fatal("selected refuges were ignored")
	}
}

func TestPauseResumeCancelAndRestart(t *testing.T) {
	m, c := testManager(t, nil)
	i := create(t, m, request(4), "lifecycle-create-key")
	advance(t, m, c, i, 1)
	if _, err := m.Control(i.SimulationID, i.AccessToken, "pause"); err != nil {
		t.Fatal(err)
	}
	c.Advance(10 * time.Second)
	if s := state(t, m, i); s.Tick != 1 || s.Status != Paused {
		t.Fatal(s.Metadata)
	}
	if _, err := m.Control(i.SimulationID, i.AccessToken, "pause"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Control(i.SimulationID, i.AccessToken, "resume"); err != nil {
		t.Fatal(err)
	}
	advance(t, m, c, i, 2)
	if _, err := m.Control(i.SimulationID, i.AccessToken, "cancel"); err != nil {
		t.Fatal(err)
	}
	if m.Stats().Active != 0 {
		t.Fatal("cancel did not release engine capacity")
	}
	_, err := m.Control(i.SimulationID, i.AccessToken, "resume")
	expectError(t, err, 409)
	j, err := m.Restart(context.Background(), i.SimulationID, i.AccessToken, "lifecycle-restart-key", "test-ip")
	if err != nil {
		t.Fatal(err)
	}
	if j.SimulationID == i.SimulationID || j.Seed != i.Seed || !reflect.DeepEqual(j.Config, i.Config) || j.Tick != 0 {
		t.Fatal(j)
	}
	if s := state(t, m, i); s.Tick != 2 || s.Status != Cancelled {
		t.Fatal("restart changed previous result")
	}
	j2, err := m.Restart(context.Background(), i.SimulationID, i.AccessToken, "lifecycle-restart-key", "test-ip")
	if err != nil || j2.SimulationID != j.SimulationID || j2.AccessToken != j.AccessToken {
		t.Fatal("restart replay duplicated work", err)
	}
}

func TestPausePreservesRemainingInterval(t *testing.T) {
	m, c := testManager(t, nil)
	i := create(t, m, request(2), "mid-interval-pause-key")
	await(t, func() bool { return c.count(2*time.Second) == 1 })
	c.Advance(750 * time.Millisecond)
	if _, err := m.Control(i.SimulationID, i.AccessToken, "pause"); err != nil {
		t.Fatal(err)
	}
	c.Advance(10 * time.Second)
	if _, err := m.Control(i.SimulationID, i.AccessToken, "resume"); err != nil {
		t.Fatal(err)
	}
	await(t, func() bool { return c.count(1250*time.Millisecond) == 1 })
	c.Advance(1249 * time.Millisecond)
	if state(t, m, i).Tick != 0 {
		t.Fatal("paused time advanced the tick")
	}
	c.Advance(time.Millisecond)
	await(t, func() bool { return state(t, m, i).Tick == 1 })
}

func TestExpiryConcurrentWithEngineReleaseAccountsAllMemory(t *testing.T) {
	m, c := testManager(t, func(o *Options) { o.CompletedTTL = time.Nanosecond })
	for n := 0; n < 20; n++ {
		i := create(t, m, request(1), fmt.Sprintf("cleanup-race-key-%04d", n))
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); _, _ = m.Control(i.SimulationID, i.AccessToken, "cancel") }()
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				c.Advance(time.Nanosecond)
				m.Cleanup()
				runtime.Gosched()
			}
		}()
		wg.Wait()
		c.Advance(time.Nanosecond)
		m.Cleanup()
		await(t, func() bool { return m.Stats().Active == 0 })
		m.Cleanup()
		if m.Stats().EstimatedMemoryBytes != 0 {
			t.Fatalf("retention reservation leaked: %+v", m.Stats())
		}
	}
}

func logical(s State) State {
	s.Metadata = Metadata{}
	s.Snapshot.Metrics.HTTPP50MS, s.Snapshot.Metrics.HTTPP95MS, s.Snapshot.Metrics.HTTPP99MS = 0, 0, 0
	if s.ScenarioState != nil {
		s.ScenarioState.Performance = world.SimulationPerformance{}
	}
	return s
}

func TestPauseResumePreservesDeterministicResultsBothScenarios(t *testing.T) {
	for _, scenario := range []string{"zombie_outbreak", "urban_flood"} {
		t.Run(scenario, func(t *testing.T) {
			m, c := testManager(t, nil)
			req := request(3)
			req.Scenario = scenario
			a := create(t, m, req, "deterministic-a-key")
			b := create(t, m, req, "deterministic-b-key")
			if _, err := m.Control(b.SimulationID, b.AccessToken, "pause"); err != nil {
				t.Fatal(err)
			}
			for tick := 1; tick <= 3; tick++ {
				advance(t, m, c, a, tick)
			}
			await(t, func() bool { return m.Stats().Active == 1 })
			if _, err := m.Control(b.SimulationID, b.AccessToken, "resume"); err != nil {
				t.Fatal(err)
			}
			for tick := 1; tick <= 3; tick++ {
				advance(t, m, c, b, tick)
			}
			if !reflect.DeepEqual(logical(state(t, m, a)), logical(state(t, m, b))) {
				t.Fatal("pause/resume changed logical outcomes")
			}
			s, err := m.GetSnapshot(b.SimulationID, b.AccessToken, true)
			if err != nil || s.Results.InitialSurvivors != 8 {
				t.Fatal(err, s.Results)
			}
			if scenario == "urban_flood" && (s.ScenarioState == nil || s.ScenarioState.DataProvenance.Model == "" || len(s.Snapshot.Zombies) != 0) {
				t.Fatal("real flood scenario not integrated")
			}
		})
	}
}

func TestConcurrentIdempotencyAndControls(t *testing.T) {
	m, c := testManager(t, nil)
	var wg sync.WaitGroup
	ids := make(chan Metadata, 12)
	errs := make(chan error, 12)
	for n := 0; n < 12; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			i, err := m.CreateAndStart(context.Background(), request(2), "concurrent-create-key", "test-ip")
			ids <- i
			errs <- err
		}()
	}
	wg.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var first Metadata
	for i := range ids {
		if first.SimulationID == "" {
			first = i
		}
		if i.SimulationID != first.SimulationID || i.AccessToken != first.AccessToken {
			t.Fatal("idempotency race")
		}
	}
	if m.Stats().Active != 1 {
		t.Fatal("duplicate engine loops")
	}
	for n := 0; n < 24; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			action := "pause"
			if n%2 == 0 {
				action = "resume"
			}
			_, _ = m.Control(first.SimulationID, first.AccessToken, action)
		}(n)
	}
	wg.Wait()
	_, _ = m.Control(first.SimulationID, first.AccessToken, "resume")
	advance(t, m, c, first, 1)
	if s := state(t, m, first); s.Tick != 1 {
		t.Fatal("turn executed multiple times", s.Tick)
	}
	req := request(2)
	req.Seed = pointer(int64(777))
	_, err := m.CreateAndStart(context.Background(), req, "concurrent-create-key", "test-ip")
	expectError(t, err, 409)
}

func TestQuotasFullRetainedMemoryAndTTL(t *testing.T) {
	t.Run("full and paused", func(t *testing.T) {
		m, _ := testManager(t, nil)
		req := request(2)
		req.GraphProfile = "FULL_MANTA"
		a := create(t, m, req, "full-active-key-a")
		_, _ = m.Control(a.SimulationID, a.AccessToken, "pause")
		_, err := m.CreateAndStart(context.Background(), req, "full-active-key-b", "test-ip")
		expectError(t, err, 503)
		b := create(t, m, request(2), "base-active-key-b")
		_, err = m.CreateAndStart(context.Background(), request(2), "base-active-key-c", "test-ip")
		expectError(t, err, 503)
		_, _ = m.Control(b.SimulationID, b.AccessToken, "cancel")
	})
	t.Run("retained", func(t *testing.T) {
		m, _ := testManager(t, func(o *Options) { o.MaxActive = 1; o.MaxRetained = 2 })
		for n := 0; n < 2; n++ {
			i := create(t, m, request(1), fmt.Sprintf("retained-key-%04d", n))
			_, _ = m.Control(i.SimulationID, i.AccessToken, "cancel")
		}
		_, err := m.CreateAndStart(context.Background(), request(1), "retained-key-extra", "test-ip")
		expectError(t, err, 503)
	})
	t.Run("memory", func(t *testing.T) {
		m, _ := testManager(t, func(o *Options) { o.MaxMemoryBytes = baseReservation })
		a := create(t, m, request(1), "memory-key-first")
		_, _ = m.Control(a.SimulationID, a.AccessToken, "cancel")
		_, err := m.CreateAndStart(context.Background(), request(1), "memory-key-extra", "test-ip")
		expectError(t, err, 503)
	})
	t.Run("paused ttl authenticated tombstone", func(t *testing.T) {
		m, c := testManager(t, func(o *Options) { o.PausedTTL = 3 * time.Second })
		i := create(t, m, request(2), "paused-expiry-key")
		_, _ = m.Control(i.SimulationID, i.AccessToken, "pause")
		c.Advance(2 * time.Second)
		_, _ = m.Get(i.SimulationID, i.AccessToken)
		c.Advance(time.Second)
		_, err := m.Get(i.SimulationID, i.AccessToken)
		expectError(t, err, 410)
		m.Cleanup()
		await(t, func() bool { return m.Stats().Active == 0 })
		_, err = m.Get(i.SimulationID, i.AccessToken)
		expectError(t, err, 410)
		_, err = m.Get(i.SimulationID, "incorrect")
		expectError(t, err, 404)
		if m.Stats().Retained != 0 || m.Stats().EstimatedMemoryBytes != 0 {
			t.Fatal(m.Stats())
		}
	})
	t.Run("idle unauthorized and wall", func(t *testing.T) {
		m, c := testManager(t, func(o *Options) { o.IdleTTL = 3 * time.Second; o.MaxWallTime = 4 * time.Second })
		i := create(t, m, request(10), "idle-expiry-test-key")
		c.Advance(2 * time.Second)
		_, _ = m.Get(i.SimulationID, "invalid-token")
		c.Advance(time.Second)
		_, err := m.Get(i.SimulationID, i.AccessToken)
		expectError(t, err, 410)
		m.Cleanup()
		j := create(t, m, request(10), "wall-expiry-test-key")
		c.Advance(2 * time.Second)
		_, _ = m.Get(j.SimulationID, j.AccessToken)
		c.Advance(2 * time.Second)
		_, err = m.Get(j.SimulationID, j.AccessToken)
		expectError(t, err, 410)
	})
}

func TestHTTPAuthenticationETagRateLimitAndValidation(t *testing.T) {
	m, _ := testManager(t, func(o *Options) {
		o.Origins = []string{"http://localhost:5173"}
		o.RateLimitPerMinute = 50
		o.CreateLimitPerMinute = 10
	})
	call := func(method, path, body, token string, headers map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.RemoteAddr = "192.0.2.1:1234"
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		m.ServeHTTP(w, r)
		return w
	}
	created := call("POST", "/v1/simulations", `{"scenario":"zombie_outbreak","graph_profile":"BASE","config":{"survivors":8}}`, "", map[string]string{"Idempotency-Key": "http-create-request-key"})
	if created.Code != 201 {
		t.Fatal(created.Code, created.Body.String())
	}
	var i Metadata
	_ = json.Unmarshal(created.Body.Bytes(), &i)
	if got := call("GET", "/v1/simulations/"+i.SimulationID+"/state", "", "", nil); got.Code != 401 {
		t.Fatal(got.Code)
	}
	got := call("GET", "/v1/simulations/"+i.SimulationID+"/state", "", i.AccessToken, nil)
	if tag := got.Header().Get("ETag"); !strings.HasPrefix(tag, `W/"`) || strings.Contains(tag, `\`) {
		t.Fatalf("malformed weak ETag: %q", tag)
	}
	if got.Code != 200 || strings.Contains(got.Body.String(), "access_token") || strings.Contains(got.Body.String(), `"nodes"`) {
		t.Fatal(got.Code, got.Body.String())
	}
	if etag := call("GET", "/v1/simulations/"+i.SimulationID+"/state", "", i.AccessToken, map[string]string{"If-None-Match": got.Header().Get("ETag")}); etag.Code != 304 {
		t.Fatal(etag.Code)
	}
	for _, body := range []string{`{"scenario":"earthquake","graph_profile":"BASE"}`, `{"scenario":"urban_flood","graph_profile":"BASE","config":{"survivors":201}}`, `{"scenario":"zombie_outbreak","graph_profile":"BASE","config":{"rainfall_intensity":0.5}}`, `{"scenario":"zombie_outbreak","graph_profile":"BASE","tick_interval_ms":1}`, `{"Scenario":"zombie_outbreak","graph_profile":"BASE"}`, `{"scenario":"zombie_outbreak","graph_profile":"BASE","config":null}`} {
		if w := call("POST", "/v1/simulations", body, "", map[string]string{"Idempotency-Key": "invalid-input-request"}); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if w := call("POST", "/v1/simulations/"+i.SimulationID+"/restart", "{}", "", nil); w.Code != 401 {
		t.Fatal(w.Code)
	}
	for n := 0; n < 60; n++ {
		w := call("GET", "/v1/simulations/capabilities", "", "", map[string]string{"X-Forwarded-For": fmt.Sprintf("198.51.100.%d", n)})
		if n == 59 && w.Code != 429 {
			t.Fatal("spoofed forwarded headers bypassed quota")
		}
	}
}

func TestCloseReleasesAllResourcesAndRestartedProcessHasNoSessions(t *testing.T) {
	before := runtime.NumGoroutine()
	m, _ := testManager(t, nil)
	i := create(t, m, request(3), "shutdown-create-key")
	_, _ = m.Control(i.SimulationID, i.AccessToken, "pause")
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	if m.Stats().Active != 0 || m.Stats().EstimatedMemoryBytes != 0 {
		t.Fatal(m.Stats())
	}
	await(t, func() bool { return runtime.NumGoroutine() <= before+1 })
	other, _ := testManager(t, nil)
	_, err := other.Get(i.SimulationID, i.AccessToken)
	expectError(t, err, 404)
}

type panicOnTurnPlanner struct{}

func (panicOnTurnPlanner) Prepare(_ context.Context, w world.WorldSnapshot) world.WorldSnapshot {
	if w.Turn > 0 {
		panic("test engine failure")
	}
	return w
}

func TestEnginePanicFailsSessionAndReleasesLocksAndCapacity(t *testing.T) {
	m, c := testManager(t, func(o *Options) { o.CompletedTTL = time.Second })
	i := create(t, m, request(2), "engine-failure-test-key")
	s, err := m.lookup(i.SimulationID, i.AccessToken, false)
	if err != nil {
		t.Fatal(err)
	}
	s.app.Simulator.SetPlanner(panicOnTurnPlanner{})
	await(t, func() bool { return c.count(2*time.Second) == 1 })
	c.Advance(2 * time.Second)
	await(t, func() bool { return state(t, m, i).Status == Failed && m.Stats().Active == 0 })
	if !s.op.TryLock() {
		t.Fatal("engine panic retained the operation lock")
	}
	s.op.Unlock()
	final, err := m.GetSnapshot(i.SimulationID, i.AccessToken, true)
	if err != nil || final.Tick != final.Snapshot.Turn || m.Stats().EngineErrors != 1 {
		t.Fatal(final.Metadata, err, m.Stats())
	}
	c.Advance(time.Second)
	m.Cleanup()
	if m.Stats().EstimatedMemoryBytes != 0 {
		t.Fatal("failed session retained resources")
	}
}
