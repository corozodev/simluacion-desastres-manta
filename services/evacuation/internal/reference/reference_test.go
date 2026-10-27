package reference

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"corodev/evacuation/internal/world"
)

func officialCopy(t *testing.T) Bundle {
	t.Helper()
	b, e := Read("../../data/reference/manta-official.json")
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func square(left, bottom, right, top float64) []Position {
	return []Position{{left, bottom}, {right, bottom}, {right, top}, {left, top}, {left, bottom}}
}

func TestCheckedInOfficialCopyAndCorruption(t *testing.T) {
	b := officialCopy(t)
	if b.Susceptibility.FeatureCount != 59 || b.Susceptibility.VertexCount != 3463 || len(b.RainEvents.Events) != 16 || b.Susceptibility.Provenance.OriginalCRS != "EPSG:32717" || !strings.Contains(b.Susceptibility.Provenance.Attribution, "CONAGE 2024") {
		t.Fatal("source copy changed; audit acquisition explicitly")
	}
	classes := map[string]int{}
	for _, f := range b.Susceptibility.Features {
		classes[f.Properties.Susceptibility]++
	}
	if len(classes) != 3 {
		t.Fatal(classes)
	}
	path := filepath.Join(t.TempDir(), "cache.json")
	if e := Write(path, b); e != nil {
		t.Fatal(e)
	}
	loaded, e := Read(path)
	if e != nil || !reflect.DeepEqual(b, loaded) {
		t.Fatal("disk replay differs", e)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("cache permissions")
	}
	raw, _ := os.ReadFile(path)
	raw = []byte(strings.Replace(string(raw), `"ALTA"`, `"BAJA"`, 1))
	_ = os.WriteFile(path, raw, 0600)
	if _, e = Read(path); e == nil {
		t.Fatal("tampered source accepted")
	}
	service := New(path, "../../data/reference/manta-official.json", false)
	defer service.Close()
	if service.Status().DatasetVersion != b.Susceptibility.Provenance.DatasetVersion || service.Status().LastRefreshError == "" {
		t.Fatal("did not retain valid bundled copy with visible corrupt cache warning")
	}
	absent := New(path, "missing.json", false)
	defer absent.Close()
	if absent.Status().Availability != "unavailable" {
		t.Fatal("fabricated fallback")
	}
}

func TestGeometryBoundsHolesAndConservativeCircleIntersection(t *testing.T) {
	g := Geometry{Type: "MultiPolygon", Coordinates: [][][]Position{{square(-80.75, -.98, -80.73, -.96), square(-80.745, -.975, -80.735, -.965)}}}
	if _, e := ValidateGeometry(g); e != nil {
		t.Fatal(e)
	}
	if circleIntersects(g, Position{-80.74, -.97}, 50) {
		t.Fatal("hole treated as susceptibility")
	}
	if !circleIntersects(g, Position{-80.75, -.97}, 20) || !circleIntersects(g, Position{-80.76, -.97}, 1200) {
		t.Fatal("boundary/circle intersection missed")
	}
	bad := clone(g)
	bad.Coordinates[0][0][0][0] = 500000
	if _, e := ValidateGeometry(bad); e == nil {
		t.Fatal("UTM accepted as longitude")
	}
	bad = clone(g)
	bad.Coordinates[0][0] = bad.Coordinates[0][0][:4]
	if _, e := ValidateGeometry(bad); e == nil {
		t.Fatal("open ring accepted")
	}
	for _, s := range []string{"NaN,-1,-80,-.9", "-180,-90,180,90", "-80.7,-1,-80.8,-.95", "1,2,3"} {
		if _, e := ParseBBox(s); e == nil {
			t.Fatal("invalid bbox", s)
		}
	}
	c := Collection{Features: []Feature{{ID: "test-only", Properties: Properties{Susceptibility: "ALTA"}, Geometry: g}}}
	use := ZoneUse(c, "experiment", world.GeoPoint{Lat: -.97, Lng: -80.75}, 20, .25)
	if use.Factor != 1.5 || use.Susceptibility != "ALTA" {
		t.Fatal(use)
	}
	if ZoneUse(c, "hole", world.GeoPoint{Lat: -.97, Lng: -80.74}, 20, .25).Susceptibility != "NONE" {
		t.Fatal("invented class")
	}
}

func TestArcGISCapabilitiesBoundedIDsAndGeoJSON(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		q := r.URL.Query()
		events := strings.HasPrefix(r.URL.Path, "/events")
		if strings.HasPrefix(r.URL.Path, "/portal/") {
			fmt.Fprint(w, `{"modified":1745520609987}`)
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/query") {
			geom, sr, id, fields := "esriGeometryPolygon", 32717, "sus", "[{\"name\":\"FID\",\"type\":\"esriFieldTypeOID\"},{\"name\":\"sui\",\"type\":\"esriFieldTypeString\"}]"
			if events {
				geom, sr, id, fields = "esriGeometryPoint", 4326, "events", "[]"
			}
			fmt.Fprintf(w, `{"name":"Test double, not real official geography","geometryType":%q,"extent":{"spatialReference":{"wkid":%d}},"fields":%s,"serviceItemId":%q,"capabilities":"Query","supportedQueryFormats":"JSON, geoJSON","maxRecordCount":2,"advancedQueryCapabilities":{"supportsPagination":false}}`, geom, sr, fields, id)
			return
		}
		if q.Get("geometry") == "" || q.Get("inSR") != "4326" || q.Get("resultOffset") != "" {
			t.Error("unbounded/unsupported query", q)
		}
		field := "FID"
		if events {
			field = "objectid"
		}
		if q.Get("returnIdsOnly") == "true" {
			ids := []int{1, 2, 3}
			if events {
				ids = []int{1}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"objectIdFieldName": field, "objectIds": ids})
			return
		}
		if q.Get("outSR") != "4326" || q.Get("f") != "geojson" || len(strings.Split(q.Get("objectIds"), ",")) > 2 {
			t.Error("CRS/batch mismatch", q)
		}
		features := []any{}
		for _, id := range strings.Split(q.Get("objectIds"), ",") {
			properties := map[string]any{}
			var n int
			_, _ = fmt.Sscan(id, &n)
			properties[field] = n
			var geometry any
			if events {
				properties["evento"] = "Inundación"
				properties["canton"] = "MANTA"
				properties["fechadelevento"] = "2025-02-19"
				properties["fechadecierredelevento"] = "N/A"
				geometry = map[string]any{"type": "Point", "coordinates": Position{-80.74, -.97}}
			} else {
				if q.Get("where") != "sui IN ('ALTA','MEDIA','BAJA')" {
					t.Error("unknown source classes were not filtered")
				}
				properties["sui"] = []string{"ALTA", "MEDIA", "BAJA"}[n-1]
				properties["anno"] = 2025
				geometry = map[string]any{"type": "Polygon", "coordinates": [][]Position{square(-80.75, -.98, -80.73, -.96)}}
			}
			features = append(features, map[string]any{"type": "Feature", "properties": properties, "geometry": geometry})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"type": "FeatureCollection", "features": features})
	}))
	defer server.Close()
	c := NewClient()
	c.HTTP = server.Client()
	c.susceptibility = server.URL + "/sus"
	c.events = server.URL + "/events"
	c.portal = server.URL + "/portal/"
	b, e := c.Fetch(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if b.Susceptibility.FeatureCount != 3 || len(b.RainEvents.Events) != 1 || calls.Load() != 9 || c.Metrics().ResponseBytes == 0 {
		t.Fatal(calls.Load(), b)
	}
}

func TestProviderErrorsRetriesAndDeadline(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fmt.Fprint(w, `{"error":{"code":503,"message":"provider error with HTTP 200"}}`)
	}))
	defer server.Close()
	c := NewClient()
	c.HTTP = server.Client()
	c.susceptibility = server.URL
	if _, e := c.Fetch(context.Background()); e == nil {
		t.Fatal("ArcGIS error envelope accepted")
	}
	if calls.Load() != 2 || c.Metrics().ProviderErrors != 2 {
		t.Fatal("unbounded retries", calls.Load())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := c.Fetch(ctx); e == nil {
		t.Fatal("cancelled fetch accepted")
	}
}

func TestOfflineReadsAndRefreshDoNotWaitForProvider(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	c := NewClient()
	c.HTTP = server.Client()
	c.susceptibility = server.URL
	s := New(filepath.Join(t.TempDir(), "cache.json"), "../../data/reference/manta-official.json", true, c)
	defer s.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !s.Refresh(ctx) {
		t.Fatal("refresh not scheduled")
	}
	if !s.Status().Refreshing {
		t.Fatal("refresh ran synchronously")
	}
	done := make(chan bool, 1)
	go func() { c, e := s.Collection(""); done <- e == nil && c.FeatureCount == 59 }()
	select {
	case valid := <-done:
		if !valid {
			t.Fatal("lost cache")
		}
	case <-time.After(time.Second):
		t.Fatal("cache read waited for network")
	}
	cancel()
	s.Close()
	if s.Refresh(context.Background()) {
		t.Fatal("refresh after close")
	}
	if s.Status().ProviderStatus != "error" || s.Status().DatasetVersion == "" {
		t.Fatal("failure discarded cache")
	}
}
