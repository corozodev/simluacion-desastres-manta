// Package simulation owns authoritative state, seeded randomness and turn order.
// It only gives DecisionClient the observable snapshot through world.Store.
package simulation

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/world"
)

// ScheduledEvent refers to an actual edge ID, or a deterministic index in the
// sorted edge IDs when EdgeID is empty. Type is an explicit scenario label.
type ScheduledEvent struct {
	Turn      int    `json:"turn"`
	EdgeID    string `json:"edge_id"`
	EdgeIndex int    `json:"edge_index"`
	Blocked   bool   `json:"blocked"`
	Type      string `json:"type"`
}

type Config struct {
	// ZombiePolicy is private run configuration. Empty preserves classic_random.
	ZombiePolicy string `json:"zombie_policy,omitempty"`
	RescueFleet  bool   `json:"rescue_fleet,omitempty"`
	// SpawnExcludedNodeIDs freezes the original shelter exclusions when a
	// session chooses a shelter subset. It keeps comparison populations and
	// RNG consumption identical without changing the historical round files.
	SpawnExcludedNodeIDs   []string         `json:"-"`
	ScenarioType           string           `json:"scenario_type,omitempty"`
	Flood                  *flood.Config    `json:"flood,omitempty"`
	Name                   string           `json:"name"`
	Seed                   int64            `json:"seed"`
	Turns                  int              `json:"turns"`
	Survivors              int              `json:"survivors"`
	Walkers                int              `json:"walkers"`
	Runners                int              `json:"runners"`
	Hordes                 int              `json:"hordes"`
	Sleepers               int              `json:"sleepers"`
	Concurrency            int              `json:"concurrency"`
	HordeMoveEvery         int              `json:"horde_move_every"`
	Events                 []ScheduledEvent `json:"events"`
	InitialSurvivors       []world.Survivor `json:"initial_survivors,omitempty"`
	InitialZombies         []world.Zombie   `json:"initial_zombies,omitempty"`
	UseSpawnZones          bool             `json:"use_spawn_zones,omitempty"`
	SpawnZoneWeights       []ZoneWeight     `json:"spawn_zone_weights,omitempty"`
	AllowInitialOverlaps   bool             `json:"allow_initial_overlaps,omitempty"`
	InitialRandomNodeCount int              `json:"initial_random_node_count,omitempty"`
}

type ZoneWeight struct {
	ZoneID string  `json:"zone_id"`
	Weight float64 `json:"weight"`
}

func LoadConfig(path string) (Config, error) {
	f, err := os.Open(path)
	if err != nil {
		return Config{}, err
	}
	defer f.Close()
	var cfg Config
	d := json.NewDecoder(io.LimitReader(f, 1<<20))
	d.DisallowUnknownFields()
	if err := d.Decode(&cfg); err != nil {
		return Config{}, fmt.Errorf("scenario: %w", err)
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return Config{}, fmt.Errorf("scenario must contain one JSON object")
	}
	return normalizeScenario(cfg)
}
