package reference

import (
	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/world"
	"time"
)

// Configure derives weights locally from an immutable version. Constructing the
// preview consumes its own PRNG; original seed, zones and rainfall stay intact.
func Configure(c Collection, cfg *flood.Config, g *world.Graph, seed int64, strength float64) error {
	nodes := map[string]world.GeoPoint{}
	for _, n := range g.Nodes {
		nodes[n.ID] = world.GeoPoint{Lat: n.Lat, Lng: n.Lng}
	}
	use := &world.ReferenceUse{Category: "official_reference", DatasetVersion: c.Provenance.DatasetVersion, SourceURL: c.Provenance.URL, ConsultedAt: c.Provenance.ConsultedAt.Format(time.RFC3339Nano), Strength: strength, Zones: []world.ReferenceZoneUse{}}
	if len(cfg.Zones) > 0 {
		for _, z := range cfg.Zones {
			use.Zones = append(use.Zones, ZoneUse(c, z.ID, nodes[z.CenterNode], z.RadiusMaxM, strength))
		}
	} else {
		preview, err := flood.New(g, seed, *cfg)
		if err != nil {
			return err
		}
		for _, z := range preview.Zones() {
			use.Zones = append(use.Zones, ZoneUse(c, z.ID, z.Center, 800, strength))
		}
	}
	cfg.GeographicReference = use
	_, err := cfg.WithDefaults()
	return err
}
