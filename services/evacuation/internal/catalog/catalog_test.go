package catalog

import (
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"corodev/evacuation/internal/simulation"
)

func TestReviewedCatalogAndPreservedCompetition(t *testing.T) {
	c, err := New("../../data", "../../scenarios/urban", Options{})
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string][2]int{"competition": {300, 383}, "full": {9179, 13452}, "expanded": {1000, 1599}}
	for _, p := range c.Presets() {
		g, err := c.Graph(p.ID)
		if err != nil {
			t.Fatal(err)
		}
		if [2]int{len(g.Nodes), len(g.Edges)} != expected[p.ID] || !p.PreviewAvailable {
			t.Fatal("incorrect catalog", p.ID)
		}
		if p.Enabled != (p.ID == "competition") {
			t.Fatal("experimental activation must be opt-in")
		}
		g.Nodes[0].ID = "mutated"
		again, _ := c.Graph(p.ID)
		if again.Nodes[0].ID == "mutated" {
			t.Fatal("catalog graph was mutable")
		}
	}
	for _, r := range c.Rounds() {
		original, err := simulation.LoadConfig(filepath.Join("../../scenarios/urban", r.ID+".json"))
		if err != nil {
			t.Fatal(err)
		}
		cfg, err := c.Config("competition", r.ID, nil)
		if err != nil || !reflect.DeepEqual(original, cfg) {
			t.Fatal("competition scenario changed", r.ID, err)
		}
	}
	if _, err := c.Graph("../../etc/passwd"); err == nil {
		t.Fatal("arbitrary graph path accepted")
	}
}

func TestPhysicalRoadEventsAndSeedConfiguration(t *testing.T) {
	c, err := New("../../data", "../../scenarios/urban", Options{EnableFull: true, EnableExpanded: true, Concurrency: 16})
	if err != nil {
		t.Fatal(err)
	}
	base, _ := c.Graph("competition")
	ids := []string{}
	for _, e := range base.Edges {
		ids = append(ids, e.ID)
	}
	sort.Strings(ids)
	seed := int64(42)
	for _, mode := range []string{"full", "expanded"} {
		cfg, err := c.Config(mode, "round3", &seed)
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Seed != 42 || cfg.Concurrency != 16 || cfg.Turns != 150 || cfg.Survivors != 200 || cfg.Events[0].EdgeID != ids[1] || cfg.Events[1].EdgeID != ids[2] {
			t.Fatal("event or scenario mapping changed")
		}
		round2, err := c.Config(mode, "round2", nil)
		if err != nil || round2.Events[0].EdgeID != "E-4420ceab96c993b4" {
			t.Fatal("physical bridge mapping failed")
		}
	}
}
