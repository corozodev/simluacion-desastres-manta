package incidents

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"corodev/evacuation/internal/world"
)

func testGraph() *world.Graph {
	return &world.Graph{Version: "real-road-test-v1", Nodes: []world.GraphNode{{ID: "a", Lat: 0, Lng: 0}, {ID: "b", Lat: 0, Lng: .002}, {ID: "c", Lat: .002, Lng: 0}, {ID: "d", Lat: .002, Lng: .002}}, Edges: []world.GraphEdge{{ID: "ab", From: "a", To: "b", RoadType: "residential"}, {ID: "ac", From: "a", To: "c", RoadType: "secondary"}, {ID: "bd", From: "b", To: "d", RoadType: "residential"}, {ID: "cd", From: "c", To: "d", RoadType: "residential"}}}
}
func testCreate(now time.Time) Create {
	return Create{IncidentType: "road_closed", Latitude: .000015, Longitude: .00054321, Description: "Calle cerrada declarada", SeverityReported: "moderate", RoadPassabilityReported: "blocked", EventTime: now.Add(-time.Minute), LocationMethod: "manual"}
}
func testStore(t *testing.T) (*Store, time.Time) {
	t.Helper()
	s, err := Open(t.TempDir(), testGraph())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	return s, now
}

func TestResolveUsesStreetGeometryAndRejectsAmbiguity(t *testing.T) {
	s, _ := testStore(t)
	for _, input := range []Location{{Latitude: math.NaN()}, {Latitude: 91}, {Latitude: 0, Longitude: 181}} {
		if _, err := s.Resolve(input); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid coordinates accepted", input)
		}
	}
	for _, input := range []Location{{Latitude: .001, Longitude: .001}, {Latitude: 1, Longitude: 1}, {Latitude: .00001, Longitude: .0005, EdgeIDHint: "cd"}} {
		r, err := s.Resolve(input)
		if err != nil || r.Matched || r.Ambiguous {
			t.Fatal("remote location/hint matched", r, err)
		}
	}
	r, err := s.Resolve(Location{Latitude: 0, Longitude: 0})
	if err != nil || r.Matched || !r.Ambiguous || len(r.Candidates) != 2 {
		t.Fatal(r, err)
	}
	r, err = s.Resolve(Location{Latitude: 0, Longitude: 0, EdgeIDHint: "ac"})
	if err != nil || !r.Matched || r.Ambiguous || r.Candidates[0].EdgeID != "ac" {
		t.Fatal("valid close choice was not retained", r, err)
	}
	// A curved OSM polyline must beat the straight endpoint chord.
	g := testGraph()
	g.Edges[0].Geometry = []world.GeoPoint{{Lat: 0, Lng: 0}, {Lat: .001, Lng: .001}, {Lat: 0, Lng: .002}}
	resolver, err := newResolver(g)
	if err != nil {
		t.Fatal(err)
	}
	r, err = resolver.resolve(Location{Latitude: .001, Longitude: .001})
	if err != nil || !r.Matched || r.Candidates[0].EdgeID != "ab" || r.Candidates[0].DistanceM > 1 {
		t.Fatal("snap ignored road polyline", r, err)
	}
}

func TestStoreSurvivesRestartAndKeepsReplayDedupAndPrivacy(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir, testGraph())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	input := testCreate(now)
	input.Description = "  Calle <b>cerrada</b>\x00\n declarada  "
	i, created, err := s.Create(input, "stable_retry_key_123", "citizen", "198.51.100.77")
	if err != nil || !created {
		t.Fatal(i, created, err)
	}
	if i.SchemaVersion != 1 || i.SourceType != "citizen" || i.VerificationStatus != "pending" || i.Latitude != 0 || i.Longitude != .0005 || strings.ContainsAny(i.Description, "<>\x00\n") || i.SnapDistanceM < 1 || i.LocationPrecisionM != 20 {
		t.Fatal("unsafe public projection", i)
	}
	if _, err := Open(dir, testGraph()); err == nil {
		t.Fatal("second writer acquired same directory")
	}
	for _, path := range []string{dir, filepath.Join(dir, "snapshot.json")} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		wanted := os.FileMode(0600)
		if path == dir {
			wanted = 0700
		}
		if info.Mode().Perm() != wanted {
			t.Fatal("private permissions missing", info.Mode())
		}
	}
	raw, err := os.ReadFile(filepath.Join(dir, "snapshot.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "stable_retry_key_123") || strings.Contains(string(raw), "198.51.100.77") || !strings.Contains(string(raw), "0.00054321") {
		t.Fatal("raw key/IP persisted or original coordinate lost")
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir, testGraph())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	replayed, created, err := s.Create(input, "stable_retry_key_123", "citizen", "different-ip")
	if err != nil || created || replayed.IncidentID != i.IncidentID {
		t.Fatal("retry after restart duplicated report", replayed, created, err)
	}
	input.Description = "Descripción diferente"
	if _, _, err = s.Create(input, "stable_retry_key_123", "citizen", "ip"); !errors.Is(err, ErrConflict) {
		t.Fatal("same key changed body", err)
	}
	input.Description = "Otra observación en la misma calle"
	duplicate, created, err := s.Create(input, "dedup_new_key_12345", "citizen", "ip")
	if err != nil || created || duplicate.IncidentID != i.IncidentID {
		t.Fatal("basic close duplicate was not detected", duplicate, created, err)
	}
	encoded, _ := json.Marshal(replayed)
	if strings.Contains(string(encoded), "raw_") || strings.Contains(string(encoded), "writer") || strings.Contains(string(encoded), "body_hash") {
		t.Fatal("private store data in DTO")
	}
}

func TestInputValidationRateAndExpiry(t *testing.T) {
	s, now := testStore(t)
	valid := testCreate(now)
	cases := []Create{valid, valid, valid, valid, valid, valid, valid, valid, valid, valid}
	cases[0].Latitude = 100
	cases[1].Description = "tiny"
	cases[2].Description = strings.Repeat("x", 501)
	cases[3].IncidentType = "official_alert"
	cases[4].EventTime = now.Add(6 * time.Minute)
	cases[5].EventTime = now.Add(-8 * 24 * time.Hour)
	cases[6].EvidenceMetadata = &EvidenceMetadata{1, "uploaded"}
	cases[7].LocationMethod = "silent_gps"
	cases[8].RoadPassabilityReported = "safe"
	cases[9].Longitude = .001
	cases[9].Latitude = .001
	for _, input := range cases {
		if _, _, err := s.Create(input, "validation_key_12345", "citizen", "validation"); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid input accepted: %+v %v", input, err)
		}
	}
	if _, _, err := s.Create(valid, "short", "citizen", "ip"); !errors.Is(err, ErrInvalid) {
		t.Fatal("short idempotency key accepted")
	}
	if _, _, err := s.Create(valid, "official_key_12345", "official", "ip"); !errors.Is(err, ErrInvalid) {
		t.Fatal("official provenance forged")
	}
	for n := 0; n < 10; n++ {
		if _, _, err := s.Create(valid, strings.Repeat("k", 16)+string(rune('a'+n)), "citizen", "one-client"); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := s.Create(valid, "rate_limited_key_123", "citizen", "one-client"); !errors.Is(err, ErrRateLimited) {
		t.Fatal("rate limit not enforced", err)
	}
	// A valid idempotent retry must remain readable despite the rate cap.
	i, _, err := s.Create(valid, strings.Repeat("k", 16)+"a", "citizen", "one-client")
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return now.Add(25 * time.Hour) }
	i, err = s.Get(i.IncidentID)
	if err != nil || i.VerificationStatus != "expired" {
		t.Fatal(i, err)
	}
	list, err := s.List(Query{})
	if err != nil || list.Total != 0 {
		t.Fatal(list, err)
	}
	list, err = s.List(Query{VerificationStatus: "expired"})
	if err != nil || list.Total != 1 {
		t.Fatal(list, err)
	}
	if _, err = s.Review(i.IncidentID, StatusUpdate{VerificationStatus: "verified", ExpectedUpdatedAt: i.UpdatedAt}); !errors.Is(err, ErrIneligible) {
		t.Fatal("expired report reactivated", err)
	}
	if _, _, err = s.Create(valid, strings.Repeat("k", 16)+"a", "citizen", "one-client"); err != nil {
		t.Fatal("stored retry should precede old event check", err)
	}
	s.now = func() time.Time { return now.Add(8 * 24 * time.Hour) }
	if _, err = s.Get(i.IncidentID); !errors.Is(err, ErrNotFound) {
		t.Fatal("retention did not purge", err)
	}
	if len(s.data.Idempotency) != 0 {
		t.Fatal("purged report left private replay keys")
	}
}

func TestFiltersAndOptimisticReview(t *testing.T) {
	s, now := testStore(t)
	a := testCreate(now)
	i, _, err := s.Create(a, "filter_create_key_001", "citizen", "a")
	if err != nil {
		t.Fatal(err)
	}
	b := a
	b.IncidentType = "fallen_tree"
	b.Longitude = .0015
	b.EventTime = now.Add(-time.Hour)
	if _, _, err = s.Create(b, "filter_create_key_002", "citizen", "b"); err != nil {
		t.Fatal(err)
	}
	for _, q := range []Query{{IncidentType: "road_closed"}, {BBox: &Bounds{MinLatitude: -.001, MinLongitude: 0, MaxLatitude: .001, MaxLongitude: .001}}, {Since: now.Add(-5 * time.Minute)}, {Until: now.Add(-30 * time.Minute)}, {Limit: 1, Offset: 1}} {
		list, err := s.List(q)
		if err != nil || len(list.Incidents) != 1 {
			t.Fatal(q, list, err)
		}
	}
	if list, err := s.List(Query{ReceivedAfter: now}); err != nil || list.Total != 0 {
		t.Fatal(list, err)
	}
	for _, q := range []Query{{Limit: 201}, {Offset: -1}, {IncidentType: "unknown"}, {VerificationStatus: "official"}, {Since: now, Until: now.Add(-time.Hour)}, {BBox: &Bounds{MinLatitude: 0, MinLongitude: 1, MaxLatitude: 1, MaxLongitude: 0}}} {
		if _, err = s.List(q); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid query accepted", q)
		}
	}
	updated, err := s.Review(i.IncidentID, StatusUpdate{VerificationStatus: "verified", ExpectedUpdatedAt: i.UpdatedAt})
	if err != nil || updated.SourceType != "citizen" || updated.VerificationStatus != "verified" {
		t.Fatal(updated, err)
	}
	if _, err = s.Review(i.IncidentID, StatusUpdate{VerificationStatus: "rejected", ExpectedUpdatedAt: i.UpdatedAt}); !errors.Is(err, ErrConflict) {
		t.Fatal("stale review overwrote another operator")
	}
	updated, err = s.Review(i.IncidentID, StatusUpdate{VerificationStatus: "rejected", ExpectedUpdatedAt: updated.UpdatedAt})
	if err != nil {
		t.Fatal(err)
	}
	list, err := s.List(Query{})
	if err != nil || list.Total != 1 {
		t.Fatal("default query exposed rejected", list, err)
	}
	list, err = s.List(Query{VerificationStatus: "rejected"})
	if err != nil || list.Total != 1 {
		t.Fatal(list, err)
	}
}

func TestWriteFailureAndCorruptSnapshotFailClosed(t *testing.T) {
	s, now := testStore(t)
	s.write = func(diskState) error { return errors.New("test disk failure containing private path") }
	if _, _, err := s.Create(testCreate(now), "failed_write_key_123", "citizen", "ip"); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
	if len(s.data.Records) != 0 {
		t.Fatal("unpersisted record became visible")
	}
	if _, err := s.List(Query{}); !errors.Is(err, ErrUnavailable) {
		t.Fatal("failed store continued serving success")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "snapshot.json"), []byte(`{"schema_version":1,"records":`), 0600); err != nil {
		t.Fatal(err)
	}
	if s, err := Open(dir, testGraph()); err == nil {
		s.Close()
		t.Fatal("corrupt file was reset to an empty store")
	}
	// The failed open must release its process lock.
	if err := os.Remove(filepath.Join(dir, "snapshot.json")); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(dir, testGraph())
	if err != nil {
		t.Fatal("failed open retained writer lock", err)
	}
	reopened.Close()
}

func TestApplicationAuditPersistsAndDiskFailureAddsNoReceipt(t *testing.T) {
	s, _ := testStore(t)
	// Open refreshes expiry using wall time before a test clock can be injected.
	// Keep this persistence fixture current across that reopen.
	now := time.Now().UTC()
	s.now = func() time.Time { return now }
	i, _, err := s.Create(testCreate(now), "application_record_key_123", "citizen", "test")
	if err != nil {
		t.Fatal(err)
	}
	a := Application{ApplicationID: strings.Repeat("a", 32), IncidentID: i.IncidentID, RunID: strings.Repeat("b", 32), AffectedEdgeIDs: i.AffectedEdgeIDs, SimulationStep: 2, WorldVersion: 6, Effect: "blocked", ExpiresAtSimulationStep: 5}
	saved, err := s.RecordApplication(a)
	if err != nil || saved.SourceType != "citizen" || saved.VerificationStatusAtApplication != "pending" || saved.AppliedAt != now {
		t.Fatal(saved, err)
	}
	if _, err = s.RecordApplication(a); !errors.Is(err, ErrConflict) {
		t.Fatal("duplicate audit overwrite accepted")
	}
	dir := s.directory
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir, testGraph())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, exists, err := s.Application(a.RunID, i.IncidentID)
	if err != nil || !exists || got.ApplicationID != a.ApplicationID {
		t.Fatal("restart lost audit", got, exists, err)
	}
	// Reopening restores the real clock; retain the fixture clock when exercising
	// the disk error so this test cannot expire with the calendar date.
	s.now = func() time.Time { return now }
	a.ApplicationID = strings.Repeat("c", 32)
	a.RunID = strings.Repeat("d", 32)
	s.write = func(diskState) error { return errors.New("disk failure") }
	if _, err = s.RecordApplication(a); !errors.Is(err, ErrUnavailable) {
		t.Fatal("audit disk failure ignored", err)
	}
	if _, ok := s.data.Applications[applicationKey(a.RunID, a.IncidentID)]; ok {
		t.Fatal("failed durable barrier left an audit success")
	}
}
