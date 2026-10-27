// Package catalog loads only reviewed graph files and the three existing rounds.
package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

type Preset struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Nodes            int    `json:"nodes"`
	Edges            int    `json:"edges"`
	GraphVersion     string `json:"graph_version"`
	Source           string `json:"source"`
	Coverage         string `json:"coverage"`
	Experimental     bool   `json:"experimental"`
	Enabled          bool   `json:"enabled"`
	PreviewAvailable bool   `json:"preview_available"`
	DisabledReason   string `json:"disabled_reason"`
}

type Round struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Survivors int    `json:"survivors"`
	Turns     int    `json:"turns"`
}

type Options struct {
	EnableFull     bool
	EnableExpanded bool
	Concurrency    int
}

type Catalog struct {
	graphs  map[string]*world.Graph
	encoded map[string][]byte
	presets []Preset
	rounds  []Round
	configs map[string]simulation.Config
	options Options
}

// New validates the checked-in source, including exact checksums. A missing or
// incompatible experimental graph never prevents the competition mode loading.
func New(dataDir, scenarioDir string, options Options) (*Catalog, error) {
	if options.Concurrency < 0 || options.Concurrency > 200 {
		return nil, errors.New("invalid simulation concurrency")
	}
	c := &Catalog{graphs: map[string]*world.Graph{}, encoded: map[string][]byte{}, configs: map[string]simulation.Config{}, options: options}
	definitions := []struct {
		id, name, file, checksum, coverage string
		nodes, edges                       int
		enabled                            bool
	}{
		{"competition", "Competición — 300 intersecciones", "manta-v2.json", "8ab40819880d7cfda5094ca8a7878e28676404c3f3b48276d095b49c697c58d5", "Muestra operativa de la red urbana; prioridad Track A.", 300, 383, true},
		{"full", "Manta completo — 9.179 intersecciones", "manta-master.json", "ee1739af6f6166ec8b1763da96d66ab610785552e36b139070dc4da50c560f92", "Todo el grafo maestro urbano representado en FASE 2; no equivale a todas las vías de la ciudad.", 9179, 13452, options.EnableFull},
		{"expanded", "Manta ampliado — 1.000 intersecciones", "manta-expanded.json", "9380726d02bbeaa661867670a71f36ca9019b4687e1b162360209034d6e49288", "Preset intermedio experimental; no es el mapa completo.", 1000, 1599, options.EnableExpanded},
	}
	for _, d := range definitions {
		p := Preset{ID: d.id, Name: d.name, Nodes: d.nodes, Edges: d.edges, Coverage: d.coverage, Experimental: d.id != "competition"}
		path := filepath.Join(dataDir, d.file)
		raw, readErr := os.ReadFile(path)
		checksum := sha256.Sum256(raw)
		var g *world.Graph
		var err error
		if readErr != nil || hex.EncodeToString(checksum[:]) != d.checksum {
			err = errors.New("graph does not match the reviewed catalog")
		} else {
			g, err = graph.Load(path)
			if err == nil && (len(g.Nodes) != d.nodes || len(g.Edges) != d.edges || len(g.Shelters) != 4 || len(g.SpawnZones) != 4) {
				err = errors.New("unexpected graph dimensions, shelters or zones")
			}
		}
		if err != nil {
			if d.id == "competition" {
				return nil, fmt.Errorf("competition graph: %w", err)
			}
			p.DisabledReason = "Los datos de este preset no superaron la validación local."
		} else {
			encoded, encodeErr := json.Marshal(g.Clone())
			if encodeErr != nil {
				return nil, encodeErr
			}
			c.encoded[d.id] = encoded
			c.graphs[d.id] = g
			p.GraphVersion, p.Source, p.PreviewAvailable, p.Enabled = g.Version, g.Source, true, d.enabled
			if !p.Enabled {
				p.DisabledReason = "Activación experimental deshabilitada en esta instancia."
			}
		}
		c.presets = append(c.presets, p)
	}
	for n, count := range []int{20, 80, 200} {
		id := fmt.Sprintf("round%d", n+1)
		cfg, err := simulation.LoadConfig(filepath.Join(scenarioDir, id+".json"))
		if err != nil || cfg.Survivors != count || cfg.Turns != 150 || !cfg.UseSpawnZones || len(cfg.InitialSurvivors) != 0 || len(cfg.InitialZombies) != 0 {
			return nil, fmt.Errorf("round %s must match the reviewed urban scenario", id)
		}
		c.configs[id] = cfg
		c.rounds = append(c.rounds, Round{ID: id, Name: cfg.Name, Survivors: count, Turns: cfg.Turns})
	}
	return c, nil
}

func (c *Catalog) Presets() []Preset { return append([]Preset{}, c.presets...) }
func (c *Catalog) Rounds() []Round   { return append([]Round{}, c.rounds...) }

func (c *Catalog) Preset(id string) (Preset, bool) {
	for _, p := range c.presets {
		if p.ID == id {
			return p, true
		}
	}
	return Preset{}, false
}

// Graph always returns a private copy; callers cannot mutate the catalog.
func (c *Catalog) Graph(id string) (*world.Graph, error) {
	g, ok := c.graphs[id]
	if !ok {
		return nil, errors.New("graph preset unavailable")
	}
	return g.Clone(), nil
}

// Config preserves competition byte-for-byte semantics. In the other graphs an
// index-based event is resolved to its competition road ID, which exists in all
// three reviewed graphs. No synthetic edges or positional jumps are introduced.
func (c *Catalog) Config(mode, round string, seed *int64) (simulation.Config, error) {
	base, ok := c.configs[round]
	if !ok {
		return simulation.Config{}, errors.New("unknown round")
	}
	g, ok := c.graphs[mode]
	if !ok {
		return simulation.Config{}, errors.New("unknown or unavailable preset")
	}
	cfg := base
	cfg.Events = append([]simulation.ScheduledEvent{}, base.Events...)
	cfg.SpawnZoneWeights = append([]simulation.ZoneWeight{}, base.SpawnZoneWeights...)
	if seed != nil {
		cfg.Seed = *seed
	}
	if c.options.Concurrency > 0 {
		cfg.Concurrency = c.options.Concurrency
	}
	if mode != "competition" {
		ids := make([]string, 0, len(c.graphs["competition"].Edges))
		for _, edge := range c.graphs["competition"].Edges {
			ids = append(ids, edge.ID)
		}
		sort.Strings(ids)
		edges := map[string]bool{}
		for _, edge := range g.Edges {
			edges[edge.ID] = true
		}
		for i := range cfg.Events {
			e := &cfg.Events[i]
			if e.EdgeID == "" {
				if e.EdgeIndex < 0 || e.EdgeIndex >= len(ids) {
					return simulation.Config{}, errors.New("event index outside the source graph")
				}
				e.EdgeID, e.EdgeIndex = ids[e.EdgeIndex], 0
			}
			if !edges[e.EdgeID] {
				return simulation.Config{}, errors.New("reviewed road event cannot be mapped")
			}
		}
	}
	return cfg, nil
}

// WritePreview reuses immutable encoded geography. Public preview requests do
// not allocate a private master graph or run a simulator.
func (c *Catalog) WritePreview(id string, destination io.Writer) error {
	raw, ok := c.encoded[id]
	if !ok {
		return errors.New("graph preset unavailable")
	}
	_, err := destination.Write(raw)
	return err
}
