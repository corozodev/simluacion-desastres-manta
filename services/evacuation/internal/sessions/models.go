// Package sessions runs bounded, independent public simulations on demand.
package sessions

import (
	"time"

	"corodev/evacuation/internal/world"
)

type Status string

const (
	Created   Status = "CREATED"
	Running   Status = "RUNNING"
	Paused    Status = "PAUSED"
	Completed Status = "COMPLETED"
	Cancelled Status = "CANCELLED"
	Failed    Status = "FAILED"
)

func terminal(s Status) bool { return s == Completed || s == Cancelled || s == Failed }

type InputConfig struct {
	Survivors         *int     `json:"survivors,omitempty"`
	Round             string   `json:"round,omitempty"`
	RefugeIDs         []string `json:"refuge_ids,omitempty"`
	RainfallIntensity *float64 `json:"rainfall_intensity,omitempty"`
}

type CreateRequest struct {
	Scenario       string      `json:"scenario"`
	GraphProfile   string      `json:"graph_profile"`
	Seed           *int64      `json:"seed,omitempty"`
	MaxTicks       *int        `json:"max_ticks,omitempty"`
	TickIntervalMS *int        `json:"tick_interval_ms,omitempty"`
	Config         InputConfig `json:"config,omitempty"`
}

type Config struct {
	Survivors         int      `json:"survivors"`
	Round             string   `json:"round"`
	RefugeIDs         []string `json:"refuge_ids"`
	RainfallIntensity *float64 `json:"rainfall_intensity,omitempty"`
}

func (c Config) clone() Config {
	c.RefugeIDs = append([]string{}, c.RefugeIDs...)
	if c.RainfallIntensity != nil {
		value := *c.RainfallIntensity
		c.RainfallIntensity = &value
	}
	return c
}

type Metadata struct {
	SimulationID   string     `json:"simulation_id"`
	AccessToken    string     `json:"access_token,omitempty"`
	Status         Status     `json:"status"`
	Tick           int        `json:"tick"`
	MaxTicks       int        `json:"max_ticks"`
	StateVersion   uint64     `json:"state_version"`
	Scenario       string     `json:"scenario"`
	GraphProfile   string     `json:"graph_profile"`
	GraphVersion   string     `json:"graph_version"`
	Seed           int64      `json:"seed"`
	TickIntervalMS int        `json:"tick_interval_ms"`
	CreatedAt      time.Time  `json:"created_at"`
	StartedAt      time.Time  `json:"started_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	EndedAt        *time.Time `json:"ended_at,omitempty"`
	ExpiresAt      time.Time  `json:"expires_at"`
	Config         Config     `json:"config"`
}

func (i Metadata) clone() Metadata {
	i.Config = i.Config.clone()
	if i.EndedAt != nil {
		value := *i.EndedAt
		i.EndedAt = &value
	}
	return i
}

type Results struct {
	InitialSurvivors int     `json:"initial_survivors"`
	Evacuated        int     `json:"evacuated"`
	Bitten           int     `json:"bitten"`
	Active           int     `json:"active"`
	SurvivalRate     float64 `json:"survival_rate"`
	RefugesUsed      int     `json:"refuges_used"`
}

type State struct {
	Metadata
	Snapshot      world.WorldSnapshot     `json:"snapshot"`
	ScenarioState *world.ScenarioSnapshot `json:"scenario_state,omitempty"`
	Results       *Results                `json:"results,omitempty"`
}

type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }
func invalid() *Error {
	return &Error{400, "VALIDATION_ERROR", "Revisa la configuración de la simulación."}
}
func unavailable() *Error {
	return &Error{503, "UNAVAILABLE", "No hay capacidad disponible; intenta más tarde."}
}
func conflict() *Error {
	return &Error{409, "CONFLICT", "La operación no corresponde al estado de la simulación."}
}

// Clock controls both lifecycle deadlines and tick timers. Tests can advance it
// without sleeping; scheduling never uses a timer shared between sessions.
type Clock interface {
	Now() time.Time
	NewTimer(time.Duration) Timer
}
type Timer interface {
	C() <-chan time.Time
	Stop() bool
}
type realClock struct{}

func (realClock) Now() time.Time                 { return time.Now().UTC() }
func (realClock) NewTimer(d time.Duration) Timer { return realTimer{time.NewTimer(d)} }

type realTimer struct{ *time.Timer }

func (t realTimer) C() <-chan time.Time { return t.Timer.C }
