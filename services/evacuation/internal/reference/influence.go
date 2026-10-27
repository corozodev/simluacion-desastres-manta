package reference

import (
	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/world"
	"time"
)

// Configure records a reference for contextual display. Susceptibility is not
// measured water, terrain or a hydraulic source; it cannot inject volume.
func Configure(c Collection, cfg *flood.Config, _ *world.Graph, _ int64, strength float64) error {
	cfg.GeographicReference = &world.ReferenceUse{Category: "official_reference", DatasetVersion: c.Provenance.DatasetVersion, SourceURL: c.Provenance.URL, ConsultedAt: c.Provenance.ConsultedAt.Format(time.RFC3339Nano), Strength: strength, Zones: []world.ReferenceZoneUse{}}
	_, err := cfg.WithDefaults()
	return err
}
