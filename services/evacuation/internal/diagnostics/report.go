// Package diagnostics contains offline evaluation records. Initial hidden zombie
// positions belong only to private evaluation artifacts, never public snapshots.
package diagnostics

import (
	"math"
	"sort"
	"time"
)

type Spawn struct {
	ID     string  `json:"id"`
	Type   string  `json:"type"`
	NodeID string  `json:"node_id"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	ZoneID string  `json:"zone_id,omitempty"`
}

type Survivor struct {
	ID                        string  `json:"id"`
	InitialNode               string  `json:"initial_node"`
	ZoneID                    string  `json:"zone_id,omitempty"`
	InitialNearestShelterHops int     `json:"initial_nearest_shelter_hops"`
	CurrentNode               string  `json:"current_node"`
	Status                    string  `json:"status"`
	Moves                     int     `json:"moves"`
	StationaryTurns           int     `json:"stationary_turns"`
	Reversals                 int     `json:"reversals"`
	NoRouteTurns              int     `json:"no_route_turns"`
	GeographicNoRouteTurns    int     `json:"geographic_no_route_turns"`
	BlockedRouteTurns         int     `json:"blocked_route_turns"`
	ThreatRouteTurns          int     `json:"threat_route_turns"`
	FullShelterTurns          int     `json:"full_shelter_turns"`
	DestinationChanges        int     `json:"destination_changes"`
	RouteInvalidations        int     `json:"route_invalidations"`
	EvacuationTurn            int     `json:"evacuation_turn"`
	RouteEfficiency           float64 `json:"route_efficiency"`
	FinalFailure              string  `json:"final_failure,omitempty"`
}

type Bite struct {
	Turn           int    `json:"turn"`
	SurvivorID     string `json:"survivor_id"`
	ZombieID       string `json:"zombie_id"`
	ZombieType     string `json:"zombie_type"`
	Mechanism      string `json:"mechanism"`
	From           string `json:"from"`
	To             string `json:"to"`
	InitialOverlap bool   `json:"initial_overlap"`
}

type Timing struct {
	Count   int     `json:"count"`
	TotalMS float64 `json:"total_ms"`
	P50MS   float64 `json:"p50_ms"`
	P95MS   float64 `json:"p95_ms"`
	P99MS   float64 `json:"p99_ms"`
}

type Timings struct {
	Planning    Timing `json:"planning"`
	Publication Timing `json:"publication"`
	Turn        Timing `json:"turn"`
}

type Summary struct {
	Evacuated                 int     `json:"evacuated"`
	Bitten                    int     `json:"bitten"`
	Active                    int     `json:"active"`
	Alive                     int     `json:"alive"`
	StationaryTurns           int     `json:"stationary_turns"`
	NoRouteTurns              int     `json:"no_route_turns"`
	DestinationChanges        int     `json:"destination_changes"`
	RouteInvalidations        int     `json:"route_invalidations"`
	MeanEvacuationTurn        float64 `json:"mean_evacuation_turn"`
	MeanRouteEfficiency       float64 `json:"mean_route_efficiency"`
	InitialOverlaps           int     `json:"initial_overlaps"`
	InitialHordeExclusions    int     `json:"initial_horde_exclusions"`
	SheltersFull              int     `json:"shelters_full"`
	ShelterCapacityAvailable  int     `json:"shelter_capacity_available"`
	ShelterUnoccupiedCapacity int     `json:"shelter_unoccupied_capacity"`
	ShelterReserved           int     `json:"shelter_reserved"`
}

type Turn struct {
	Turn       int `json:"turn"`
	Active     int `json:"active"`
	NoRoute    int `json:"no_route"`
	Stationary int `json:"stationary"`
	Evacuated  int `json:"evacuated"`
	Bitten     int `json:"bitten"`
}

type Report struct {
	Scenario         string         `json:"scenario"`
	Seed             int64          `json:"seed"`
	GraphVersion     string         `json:"graph_version"`
	Turns            int            `json:"turns"`
	InitialSurvivors []Spawn        `json:"initial_survivors"`
	InitialZombies   []Spawn        `json:"initial_zombies"`
	Survivors        []Survivor     `json:"survivors"`
	Bites            []Bite         `json:"bites"`
	Failures         map[string]int `json:"failures"`
	Summary          Summary        `json:"summary"`
	Timeline         []Turn         `json:"timeline"`
	Timings          Timings        `json:"timings"`
}

func Measure(values []time.Duration) Timing {
	result := Timing{Count: len(values)}
	if len(values) == 0 {
		return result
	}
	ordered := append([]time.Duration{}, values...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	for _, v := range ordered {
		result.TotalMS += float64(v) / float64(time.Millisecond)
	}
	percentile := func(p float64) float64 {
		return float64(ordered[int(math.Ceil(p*float64(len(ordered))))-1]) / float64(time.Millisecond)
	}
	result.P50MS, result.P95MS, result.P99MS = percentile(.5), percentile(.95), percentile(.99)
	return result
}
