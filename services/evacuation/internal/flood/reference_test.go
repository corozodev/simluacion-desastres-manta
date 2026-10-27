package flood

import (
	"corodev/evacuation/internal/world"
	"reflect"
	"testing"
)

func TestReferenceWeightsPreserveSeedGeometryAndDryRain(t *testing.T) {
	cfg := focusedConfig()
	base := mustModel(t, fixture(), 42, cfg)
	cfg.GeographicReference = &world.ReferenceUse{Category: "official_reference", DatasetVersion: "test-double-only", SourceURL: "https://example.invalid/test", ConsultedAt: "2026-10-26T00:00:00Z", Strength: .25, Zones: []world.ReferenceZoneUse{{ZoneID: "focus", Susceptibility: "ALTA", Factor: 1.5, FeatureIDs: []string{"test-only"}}}}
	hybrid := mustModel(t, fixture(), 42, cfg)
	if !reflect.DeepEqual(base.Zones(), hybrid.Zones()) {
		t.Fatal("reference moved synthetic footprint/seed")
	}
	base.Advance(5)
	hybrid.Advance(5)
	if hybrid.Zones()[0].Intensity <= base.Zones()[0].Intensity {
		t.Fatal("categorical experiment had no effect")
	}
	cfg.RainfallIntensity = 0
	dry := mustModel(t, fixture(), 42, cfg)
	dry.Advance(5)
	if dry.Zones()[0].Intensity != 0 {
		t.Fatal("reference fabricated rainfall")
	}
	cfg.GeographicReference.Zones[0].Factor = 123
	if _, e := New(fixture(), 42, cfg); e == nil {
		t.Fatal("invalid weight accepted")
	}
	cfg.GeographicReference = hybrid.Config().GeographicReference
	cfg.GeographicReference.Zones[0].FeatureIDs[0] = "mutated"
	if hybrid.Config().GeographicReference.Zones[0].FeatureIDs[0] != "test-only" {
		t.Fatal("reference metadata aliases model state")
	}
}
