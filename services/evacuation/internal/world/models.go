// Package world defines the shared, observable simulation and decision contracts.
// Simulator-only state (PRNG, dormant zombies and scheduled events) belongs to sim.
package world

import "context"

type GraphNode struct {
	ID  string  `json:"id"`
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type GeoPoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// SpawnZone describes an approximate, sourced origin area, never a routing fence.
type SpawnZone struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Source   string     `json:"source"`
	Geometry []GeoPoint `json:"geometry"`
	NodeIDs  []string   `json:"node_ids"`
	Weight   float64    `json:"weight"`
}

type GraphEdge struct {
	ID        string     `json:"id"`
	From      string     `json:"from"`
	To        string     `json:"to"`
	DistanceM float64    `json:"distance_m"`
	RoadType  string     `json:"road_type"`
	SpeedMPS  float64    `json:"speed_mps"`
	Blocked   bool       `json:"blocked"`
	Directed  bool       `json:"directed"`
	Geometry  []GeoPoint `json:"geometry,omitempty"`
	Bridge    bool       `json:"bridge,omitempty"`
}

type Graph struct {
	Version    string      `json:"version"`
	Source     string      `json:"source"`
	Nodes      []GraphNode `json:"nodes"`
	Edges      []GraphEdge `json:"edges"`
	Shelters   []Shelter   `json:"shelters"`
	SpawnZones []SpawnZone `json:"spawn_zones,omitempty"`
	Coverage   []GeoPoint  `json:"coverage,omitempty"`
}

const (
	Walker    = "walker"
	Runner    = "runner"
	Horde     = "horde"
	Sleeper   = "sleeper"
	Active    = "active"
	Bitten    = "bitten"
	Evacuated = "evacuated"
)

// Zombie contains only observable data. Path records every node visited this turn,
// including the starting node. Dormant sleepers must never enter a snapshot.
type Zombie struct {
	ID            string   `json:"id"`
	Type          string   `json:"type"`
	CurrentNode   string   `json:"current_node"`
	MovementState string   `json:"movement_state"`
	Awake         bool     `json:"awake"`
	Path          []string `json:"path"`
}

type Survivor struct {
	VehicleID        string   `json:"vehicle_id,omitempty"`
	ID               string   `json:"id"`
	CurrentNode      string   `json:"current_node"`
	Status           string   `json:"status"`
	TargetShelterID  string   `json:"target_shelter_id"`
	PlannedRoute     []string `json:"planned_route"`
	SpawnZoneID      string   `json:"spawn_zone_id,omitempty"`
	StationaryTurns  int      `json:"stationary_turns"`
	ImmobilityReason string   `json:"immobility_reason,omitempty"`
}

// RescueVehicle publishes actual traversal only. A passenger remains active and
// at the vehicle node until delivered; planned routes are never movement proof.
type RescueVehicle struct {
	ID               string   `json:"id"`
	CurrentNode      string   `json:"current_node"`
	Path             []string `json:"path"`
	PassengerIDs     []string `json:"passenger_ids"`
	TargetSurvivorID string   `json:"target_survivor_id"`
	TargetShelterID  string   `json:"target_shelter_id"`
	State            string   `json:"state"`
	Capacity         int      `json:"capacity"`
	WaitReason       string   `json:"wait_reason,omitempty"`
}

type RescueFleetMetrics struct {
	Pickups     int `json:"pickups"`
	Delivered   int `json:"delivered"`
	Moves       int `json:"moves"`
	UsefulTrips int `json:"useful_trips"`
}

type Shelter struct {
	ID        string `json:"id"`
	NodeID    string `json:"node_id"`
	Capacity  int    `json:"capacity"`
	Occupancy int    `json:"occupancy"`
	Reserved  int    `json:"reserved"`
	Available int    `json:"available"`
}

type Event struct {
	Turn     int    `json:"turn"`
	Type     string `json:"type"`
	EntityID string `json:"entity_id"`
	EdgeID   string `json:"edge_id"`
	Message  string `json:"message"`
}

type Metrics struct {
	Evacuated       int     `json:"evacuated"`
	Bitten          int     `json:"bitten"`
	Active          int     `json:"active"`
	Turns           int     `json:"turns"`
	RequestsSuccess int     `json:"requests_success"`
	RequestsInvalid int     `json:"requests_invalid"`
	RequestsTimeout int     `json:"requests_timeout"`
	HTTPP50MS       float64 `json:"http_p50_ms"`
	HTTPP95MS       float64 `json:"http_p95_ms"`
	HTTPP99MS       float64 `json:"http_p99_ms"`
	Availability    float64 `json:"availability"`
}

type WorldSnapshot struct {
	Fleet        []RescueVehicle     `json:"fleet,omitempty"`
	FleetMetrics *RescueFleetMetrics `json:"fleet_metrics,omitempty"`
	ScenarioType string              `json:"scenario_type,omitempty"`
	Turn         int                 `json:"turn"`
	WorldVersion uint64              `json:"world_version"`
	GraphVersion string              `json:"graph_version"`
	Zombies      []Zombie            `json:"zombies"`
	Survivors    []Survivor          `json:"survivors"`
	Shelters     []Shelter           `json:"shelters"`
	BlockedEdges []string            `json:"blocked_edges"`
	Events       []Event             `json:"events"`
	Metrics      Metrics             `json:"metrics"`
	Simulation   *SimulationInfo     `json:"simulation,omitempty"`
	// Graph is local decision input; GET /grafo publishes it separately.
	Graph *Graph `json:"-"`
	// Scenario is served separately by /v1/scenario to keep /estado compact.
	Scenario *ScenarioSnapshot `json:"-"`
}

// SimulationInfo identifies the run separately from a reusable graph version.
// Operator identity belongs to the private audit log, never this public DTO.
type SimulationInfo struct {
	RunID        string `json:"run_id"`
	Mode         string `json:"mode"`
	Round        string `json:"round"`
	State        string `json:"state"`
	Seed         int64  `json:"seed"`
	GraphVersion string `json:"graph_version"`
	TurnLimit    int    `json:"turn_limit"`
	IntervalMS   int64  `json:"interval_ms"`
	StartedAt    string `json:"started_at,omitempty"`
	EndedAt      string `json:"ended_at,omitempty"`
	Failure      string `json:"failure,omitempty"`
}

type StepRequest struct {
	SurvivorID  string `json:"sobrevivienteId"`
	CurrentNode string `json:"nodoActual"`
	Turn        int    `json:"turno"`
}

type StepResponse struct {
	NextNode string `json:"siguienteNodo"`
}

type DecisionResult struct {
	NextNode        string
	TargetShelterID string
	Route           []string
	EstimatedRisk   float64
	Cost            float64
}

type DecisionEngine interface {
	NextStep(context.Context, WorldSnapshot, Survivor) DecisionResult
}

// TurnPlanner prepares one coherent plan before read-only HTTP requests arrive.
// The simulator only accepts assignment fields, retaining authoritative positions.
type TurnPlanner interface {
	Prepare(context.Context, WorldSnapshot) WorldSnapshot
}
