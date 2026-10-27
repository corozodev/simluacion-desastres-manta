package control

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/world"
)

const origin = "https://operator.example"

func newTestManager(t *testing.T, auto bool, interval time.Duration, full bool) (*Manager, string) {
	t.Helper()
	code, err := randomToken()
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(code))
	c, err := catalog.New("../../data", "../../scenarios/urban", catalog.Options{EnableFull: full, Concurrency: 16})
	if err != nil {
		t.Fatal(err)
	}
	m, err := New(c, Options{APIKey: "test-only-movement-key", Origins: []string{origin}, Interval: interval, AutoStart: auto, Engine: decision.Options{Prediction: true, RiskWeight: .6, PredictionWeight: 12}, Admin: AdminOptions{Operator: "operator", AccessHash: hex.EncodeToString(hash[:])}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close() })
	return m, code
}

func call(t *testing.T, client *http.Client, base, method, path string, body any, cookie *http.Cookie, csrf, requestOrigin string) (*http.Response, []byte) {
	t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, err := http.NewRequest(method, base+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if requestOrigin != "" {
		req.Header.Set("Origin", requestOrigin)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	r, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(r.Body)
	_ = r.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	return r, data
}

func login(t *testing.T, m *Manager, code string) (*httptest.Server, *http.Cookie, SessionState) {
	t.Helper()
	s := httptest.NewTLSServer(m)
	t.Cleanup(s.Close)
	r, body := call(t, s.Client(), s.URL, "POST", "/admin/session", map[string]string{"operator": "operator", "access_code": code}, nil, "", origin)
	if r.StatusCode != 200 || bytes.Contains(body, []byte(code)) {
		t.Fatalf("login failed or leaked credential: status%d", r.StatusCode)
	}
	var state SessionState
	if json.Unmarshal(body, &state) != nil || !state.Authenticated || state.CSRFToken == "" || len(r.Cookies()) != 1 {
		t.Fatal("invalid login response")
	}
	cookie := r.Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.Domain != "" || cookie.Path != "/" || cookie.Name != "__Host-corodev_admin" {
		t.Fatal("unsafe session cookie")
	}
	return s, cookie, state
}

func TestSessionAuthorizationCSRFAndRevocation(t *testing.T) {
	m, code := newTestManager(t, false, time.Hour, true)
	s, cookie, state := login(t, m, code)
	payload := StartRequest{Mode: "competition", Round: "round1", Seed: 42, ExpectedRunID: m.Info().RunID}
	for _, test := range []struct {
		cookie       *http.Cookie
		csrf, origin string
		status       int
	}{{nil, "", origin, 401}, {cookie, "", origin, 403}, {cookie, state.CSRFToken, "https://other.example", 403}} {
		r, _ := call(t, s.Client(), s.URL, "POST", "/admin/runs", payload, test.cookie, test.csrf, test.origin)
		if r.StatusCode != test.status {
			t.Fatal("authorization bypass", r.StatusCode, test.status)
		}
	}
	r, _ := call(t, s.Client(), s.URL, "POST", "/admin/runs", payload, cookie, state.CSRFToken, origin)
	if r.StatusCode != 201 {
		t.Fatal("authorized start failed", r.StatusCode)
	}
	r, _ = call(t, s.Client(), s.URL, "POST", "/admin/runs", payload, cookie, state.CSRFToken, origin)
	if r.StatusCode != 409 {
		t.Fatal("active round was replaced")
	}
	r, _ = call(t, s.Client(), s.URL, "DELETE", "/admin/session", nil, cookie, state.CSRFToken, origin)
	if r.StatusCode != 200 {
		t.Fatal("logout failed")
	}
	r, _ = call(t, s.Client(), s.URL, "POST", "/admin/runs", payload, cookie, state.CSRFToken, origin)
	if r.StatusCode != 401 {
		t.Fatal("revoked session accepted")
	}
}

func TestPublicPreviewDoesNotActivateExperimental(t *testing.T) {
	m, _ := newTestManager(t, false, time.Hour, false)
	s := httptest.NewServer(m)
	defer s.Close()
	before := m.Info()
	r, body := call(t, s.Client(), s.URL, "GET", "/grafo?mode=full", nil, nil, "", "")
	var g world.Graph
	if json.Unmarshal(body, &g) != nil || r.StatusCode != 200 || len(g.Nodes) != 9179 {
		t.Fatal("master preview unavailable")
	}
	for _, shelter := range g.Shelters {
		if shelter.Capacity != shelter.Occupancy+shelter.Reserved+shelter.Available {
			t.Fatal("preview has incoherent shelter availability")
		}
	}
	if m.Info() != before {
		t.Fatal("preview activated a new run")
	}
	if _, err := m.Start(StartRequest{Mode: "full", Round: "round1", Seed: 42, ExpectedRunID: before.RunID}, "operator"); !errors.Is(err, ErrDisabled) {
		t.Fatal("disabled mode activated")
	}
	r, _ = call(t, s.Client(), s.URL, "GET", "/grafo?mode=../../etc/passwd", nil, nil, "", "")
	if r.StatusCode != 404 {
		t.Fatal("arbitrary source accepted")
	}
}

func TestConcurrentStartAndGraphRunIdentity(t *testing.T) {
	m, _ := newTestManager(t, false, time.Hour, true)
	id := m.Info().RunID
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := m.Start(StartRequest{Mode: "full", Round: "round1", Seed: 42, ExpectedRunID: id}, "operator")
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	success, rejected := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrActive) {
			rejected++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || rejected != 1 {
		t.Fatal("concurrent activation was not serialized")
	}
	s := httptest.NewServer(m)
	defer s.Close()
	r, _ := call(t, s.Client(), s.URL, "GET", "/grafo?run_id="+id, nil, nil, "", "")
	if r.StatusCode != 409 {
		t.Fatal("old run identity accepted")
	}
}

func TestFinalStatePreservedAndStaleRunRejected(t *testing.T) {
	m, _ := newTestManager(t, true, 0, true)
	deadline := time.Now().Add(10 * time.Second)
	for m.Info().State == "running" && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	old := m.Info()
	if old.State != "finished" {
		t.Fatal("round did not finish")
	}
	_, err := m.Start(StartRequest{Mode: "competition", Round: "round1", Seed: 7, ExpectedRunID: old.RunID}, "operator")
	if err != nil {
		t.Fatal(err)
	}
	saved, ok := m.saved(old.RunID)
	if !ok || saved.Turn != 150 || saved.Simulation.RunID != old.RunID {
		t.Fatal("previous observable state lost")
	}
	for _, z := range saved.Zombies {
		if z.Type == world.Sleeper && !z.Awake {
			t.Fatal("private sleeper exposed")
		}
	}
}

func TestInvalidTransitionPreservesCurrentAndIndependentCredential(t *testing.T) {
	m, code := newTestManager(t, false, time.Hour, true)
	before := m.Info()
	if _, err := m.Start(StartRequest{Mode: "full", Round: "arbitrary", Seed: 1, ExpectedRunID: before.RunID}, "operator"); !errors.Is(err, ErrInvalid) {
		t.Fatal("unapproved round accepted")
	}
	if m.Info() != before {
		t.Fatal("failed preparation changed the current run")
	}
	if _, err := m.Start(StartRequest{Mode: "full", Round: "round1", Seed: 1, ExpectedRunID: "stale"}, "operator"); !errors.Is(err, ErrChanged) {
		t.Fatal("stale run was replaced")
	}
	s, cookie, state := login(t, m, code)
	r, _ := call(t, s.Client(), s.URL, "POST", "/admin/runs", map[string]string{"mode": "full", "round": "round1", "expected_run_id": before.RunID}, cookie, state.CSRFToken, origin)
	if r.StatusCode != 400 || m.Info() != before {
		t.Fatal("missing seed accepted or changed current run")
	}
	_, otherCookie, other := login(t, m, code)
	r, _ = call(t, s.Client(), s.URL, "POST", "/admin/runs", StartRequest{Mode: "competition", Round: "round1", Seed: 1, ExpectedRunID: before.RunID}, otherCookie, state.CSRFToken, origin)
	if other.CSRFToken == state.CSRFToken || r.StatusCode != 403 {
		t.Fatal("CSRF material was not session-bound")
	}
	hash := sha256.Sum256([]byte(code))
	if rejected, err := New(m.catalog, Options{APIKey: code, Origins: []string{origin}, Admin: AdminOptions{Operator: "operator", AccessHash: hex.EncodeToString(hash[:])}}); err == nil {
		_ = rejected.Close()
		t.Fatal("movement credential reused for administration")
	}
}

func TestAdminSessionExpiryRateLimitAndKeyIndependence(t *testing.T) {
	m, code := newTestManager(t, false, time.Hour, false)
	s, cookie, _ := login(t, m, code)
	m.auth.mu.Lock()
	for id, v := range m.auth.items {
		v.expires = time.Now().Add(-time.Second)
		m.auth.items[id] = v
	}
	m.auth.mu.Unlock()
	r, body := call(t, s.Client(), s.URL, "GET", "/admin/session", nil, cookie, "", origin)
	var state SessionState
	_ = json.Unmarshal(body, &state)
	if r.StatusCode != 200 || state.Authenticated {
		t.Fatal("expired session accepted")
	}
	for i := 0; i < 10; i++ {
		r, _ = call(t, s.Client(), s.URL, "POST", "/admin/session", map[string]string{"operator": "operator", "access_code": "invalid"}, nil, "", origin)
	}
	if r.StatusCode != 429 {
		t.Fatal("login rate limit missing")
	}
	if m.auth.authenticate("operator", m.options.APIKey) {
		t.Fatal("movement key accepted by admin")
	}
}

func TestDisabledLegacyStartPreservesAuthenticationAndIdleWorld(t *testing.T) {
	fixture, code := newTestManager(t, false, time.Hour, false)
	options := fixture.options
	options.DisableStart = true
	m, err := New(fixture.catalog, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close() })
	s, cookie, session := login(t, m, code)
	before := m.Info()
	payload := StartRequest{Mode: "competition", Round: "round1", Seed: 42, ExpectedRunID: before.RunID}
	r, _ := call(t, s.Client(), s.URL, "POST", "/admin/runs", payload, nil, "", origin)
	if r.StatusCode != 401 {
		t.Fatal("legacy restriction bypassed authentication", r.StatusCode)
	}
	r, body := call(t, s.Client(), s.URL, "POST", "/admin/runs", payload, cookie, session.CSRFToken, origin)
	if r.StatusCode != 409 || !bytes.Contains(body, []byte(`"code":"RUN_ACTIVE"`)) {
		t.Fatal("legacy execution bypassed public quotas", r.StatusCode, string(body))
	}
	if after := m.Info(); after != before || after.State != "idle" {
		t.Fatal("refused legacy start changed execution", after)
	}
	r, body = call(t, s.Client(), s.URL, "GET", "/estado", nil, nil, "", "")
	var snapshot world.WorldSnapshot
	if r.StatusCode != 200 || json.Unmarshal(body, &snapshot) != nil || snapshot.Turn != 0 || snapshot.Simulation == nil || snapshot.Simulation.RunID != before.RunID {
		t.Fatal("legacy observable compatibility changed", r.StatusCode, string(body))
	}
}
