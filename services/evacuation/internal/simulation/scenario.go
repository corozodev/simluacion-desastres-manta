package simulation

import (
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"
	"time"

	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/world"
)

// threatScenario supplies threat evolution and evacuation policy. Movement,
// HTTP decisions, clock, reservations and admission remain in Simulator.
// Future earthquake/tsunami adapters must implement this boundary explicitly;
// accepting an unimplemented scenario would silently run the wrong rules.
type threatScenario interface {
	advance(*Simulator, *[]world.Event)
	roadEvent(*Simulator, ScheduledEvent)
	admits(string) bool
	waiting(string) bool
	planned([]world.Survivor, []world.Survivor)
	finishStep(*Simulator, time.Duration)
	snapshot(*Simulator) *world.ScenarioSnapshot
}

type zombieScenario struct{}

func (zombieScenario) advance(s *Simulator, events *[]world.Event) { s.moveZombies(events) }
func (zombieScenario) roadEvent(s *Simulator, event ScheduledEvent) {
	if event.Blocked {
		s.blocked[event.EdgeID] = true
	} else {
		delete(s.blocked, event.EdgeID)
	}
}
func (zombieScenario) admits(string) bool                          { return true }
func (zombieScenario) waiting(string) bool                         { return false }
func (zombieScenario) planned([]world.Survivor, []world.Survivor)  {}
func (zombieScenario) finishStep(*Simulator, time.Duration)        {}
func (zombieScenario) snapshot(*Simulator) *world.ScenarioSnapshot { return nil }

func normalizeScenario(cfg Config) (Config, error) {
	if cfg.ZombiePolicy == "" {
		cfg.ZombiePolicy = ClassicRandom
	}
	if cfg.ZombiePolicy != ClassicRandom && cfg.ZombiePolicy != CorrelatedRandomWalk && cfg.ZombiePolicy != AdaptiveExploration {
		return cfg, fmt.Errorf("unsupported zombie_policy %q", cfg.ZombiePolicy)
	}
	if cfg.ScenarioType == "urban_flood" && (cfg.ZombiePolicy != ClassicRandom || cfg.RescueFleet) {
		return cfg, fmt.Errorf("zombie policies and rescue fleet require zombie scenario")
	}
	switch cfg.ScenarioType {
	case "", "zombie":
		if cfg.Flood != nil {
			return cfg, fmt.Errorf("flood configuration requires scenario_type urban_flood")
		}
	case "urban_flood":
		if cfg.Walkers != 0 || cfg.Runners != 0 || cfg.Hordes != 0 || cfg.Sleepers != 0 || len(cfg.InitialZombies) != 0 || cfg.InitialRandomNodeCount != 0 {
			return cfg, fmt.Errorf("urban_flood cannot contain zombie threats or zombie replay state")
		}
		fc := flood.DefaultConfig()
		if cfg.Flood != nil {
			fc = *cfg.Flood
		}
		var err error
		fc, err = fc.WithDefaults()
		if err != nil {
			return cfg, err
		}
		cfg.Flood = &fc
		limit := int(math.Ceil(fc.SimulationDuration / fc.TimeStep))
		if cfg.Turns == 0 {
			cfg.Turns = limit
		}
		if cfg.Turns < 1 || cfg.Turns > limit {
			return cfg, fmt.Errorf("urban_flood turns must fit simulation_duration/time_step")
		}
	default:
		return cfg, fmt.Errorf("unsupported scenario_type %q", cfg.ScenarioType)
	}
	return cfg, nil
}

type urbanFloodScenario struct {
	model            *flood.Model
	cfg              flood.Config
	baseBlocked      map[string]bool
	external         map[string]bool
	roads            []world.RoadCondition
	shelters         []world.ShelterCondition
	started          map[string]bool
	reroutes         int
	performance      world.SimulationPerformance
	entrances        map[string][]string
	tracked          map[string]bool
	activeIncidents  map[string]appliedOverlay
	appliedIncidents map[string]appliedOverlay
	overlayMS        float64
	planningMS       float64
	planningCalls    uint64
}

func newThreatScenario(s *Simulator) (threatScenario, error) {
	if s.config.ScenarioType != "urban_flood" {
		return zombieScenario{}, nil
	}
	model, err := flood.New(s.graph, s.config.Seed, *s.config.Flood)
	if err != nil {
		return nil, err
	}
	f := &urbanFloodScenario{model: model, cfg: model.Config(), baseBlocked: map[string]bool{}, external: map[string]bool{}, started: map[string]bool{}, entrances: map[string][]string{}, tracked: map[string]bool{}}
	f.activeIncidents = map[string]appliedOverlay{}
	f.appliedIncidents = map[string]appliedOverlay{}
	for _, event := range s.events {
		f.tracked[event.EdgeID] = true
	}
	for _, sh := range s.shelters {
		for _, e := range s.graph.Edges {
			if e.To == sh.NodeID || (!e.Directed && e.From == sh.NodeID) {
				f.entrances[sh.ID] = append(f.entrances[sh.ID], e.ID)
			}
		}
	}
	for _, e := range s.graph.Edges {
		if e.Blocked {
			f.baseBlocked[e.ID] = true
		}
	}
	f.updateOverlay(s)
	f.updateBehavior(s)
	return f, nil
}

func (f *urbanFloodScenario) roadEvent(_ *Simulator, event ScheduledEvent) {
	if event.Blocked {
		f.external[event.EdgeID] = true
	} else {
		delete(f.external, event.EdgeID)
	}
}

func (f *urbanFloodScenario) advance(s *Simulator, events *[]world.Event) {
	f.expireIncidents(s)
	f.model.Advance(s.turn)
	before := s.blocked
	f.updateOverlay(s)
	for _, condition := range f.roads {
		was, now := before[condition.EdgeID], s.blocked[condition.EdgeID]
		if was != now {
			kind := "road_reopened"
			if now {
				kind = "road_blocked"
			}
			*events = append(*events, world.Event{Turn: s.turn, Type: kind, EdgeID: condition.EdgeID, Message: "Synthetic scenario road overlay updated"})
		}
	}
	f.updateBehavior(s)
}

func (f *urbanFloodScenario) updateOverlay(s *Simulator) {
	started := time.Now()
	defer func() { f.overlayMS = float64(time.Since(started)) / float64(time.Millisecond) }()
	conditions := map[string]world.RoadCondition{}
	previousRoads := map[string]world.RoadCondition{}
	for _, road := range f.roads {
		previousRoads[road.EdgeID] = road
	}
	previousShelters := map[string]world.ShelterCondition{}
	for _, sh := range f.shelters {
		previousShelters[sh.ShelterID] = sh
	}
	blocked := map[string]bool{}
	for _, road := range f.model.Roads() {
		conditions[road.EdgeID] = road
		if road.State == "blocked" {
			blocked[road.EdgeID] = true
		}
	}
	for id := range f.tracked {
		if _, ok := conditions[id]; !ok {
			conditions[id] = world.RoadCondition{EdgeID: id, State: "passable", RiskSource: "external_event", CostMultiplier: 1}
		}
	}
	independent := map[string]bool{}
	for id := range f.baseBlocked {
		independent[id] = true
	}
	for id := range f.external {
		independent[id] = true
	}
	for id := range independent {
		road, ok := conditions[id]
		if !ok {
			road = world.RoadCondition{EdgeID: id, CostMultiplier: 1}
		}
		source := "external_event"
		if f.baseBlocked[id] {
			source = "base_graph"
		}
		if road.RiskScore > 0 {
			source += "+urban_flood"
		}
		road.State, road.RiskSource, road.UpdatedAtSimulationStep = "blocked", source, s.turn
		conditions[id], blocked[id] = road, true
	}
	incidentIDs := make([]string, 0, len(f.activeIncidents))
	for id := range f.activeIncidents {
		incidentIDs = append(incidentIDs, id)
	}
	sort.Strings(incidentIDs)
	for _, id := range incidentIDs {
		entry := f.activeIncidents[id]
		for _, edgeID := range entry.input.EdgeIDs {
			road, ok := conditions[edgeID]
			if !ok {
				road = world.RoadCondition{EdgeID: edgeID, State: "passable", CostMultiplier: 1}
			}
			if entry.input.Effect == "blocked" {
				road.State = "blocked"
				blocked[edgeID] = true
			} else if road.State != "blocked" {
				road.State = "caution"
				road.CostMultiplier = math.Max(road.CostMultiplier, 2)
			}
			if !strings.Contains(road.RiskSource, "experimental_incident") {
				if road.RiskSource != "" {
					road.RiskSource += "+"
				}
				road.RiskSource += "experimental_incident"
			}
			road.UpdatedAtSimulationStep = s.turn
			conditions[edgeID] = road
		}
	}
	s.blocked = blocked
	f.roads = make([]world.RoadCondition, 0, len(conditions))
	for _, road := range conditions {
		if old, ok := previousRoads[road.EdgeID]; ok {
			if old.State == road.State && old.RiskScore == road.RiskScore && old.RiskSource == road.RiskSource && old.CostMultiplier == road.CostMultiplier {
				road.UpdatedAtSimulationStep = old.UpdatedAtSimulationStep
			} else {
				road.UpdatedAtSimulationStep = s.turn
			}
		}
		f.roads = append(f.roads, road)
	}
	sort.Slice(f.roads, func(i, j int) bool { return f.roads[i].EdgeID < f.roads[j].EdgeID })
	f.shelters = f.model.Shelters()
	// Access means at least one legal incoming street; it is separate from
	// flood exposure and does not claim reachability from every origin.
	for i := range f.shelters {
		condition := &f.shelters[i]
		accessible := false
		for _, id := range f.entrances[condition.ShelterID] {
			if !blocked[id] {
				accessible = true
				break
			}
		}
		if condition.State != "exposed" && !accessible {
			condition.State = "inaccessible"
		}
		if old, ok := previousShelters[condition.ShelterID]; ok {
			if old.State == condition.State && old.RiskScore == condition.RiskScore {
				condition.UpdatedAtSimulationStep = old.UpdatedAtSimulationStep
			} else {
				condition.UpdatedAtSimulationStep = s.turn
			}
		}
	}
}

func (f *urbanFloodScenario) updateBehavior(s *Simulator) {
	elapsed := math.Min(float64(s.turn)*f.cfg.TimeStep, f.cfg.SimulationDuration)
	for _, v := range s.survivors {
		if v.Status != world.Active || f.started[v.ID] {
			continue
		}
		risk := f.model.ExposureAt(v.CurrentNode)
		switch f.cfg.EvacuationBehavior {
		case "preventive":
			f.started[v.ID] = true
		case "late":
			f.started[v.ID] = risk >= .35 || elapsed >= .55*f.cfg.SimulationDuration
		case "adaptive":
			f.started[v.ID] = risk >= .15 || f.model.Rainfall() >= .5 || elapsed >= .2*f.cfg.SimulationDuration
		}
	}
}

func (f *urbanFloodScenario) admits(id string) bool {
	for _, sh := range f.shelters {
		if sh.ShelterID == id {
			return sh.State != "exposed" && sh.State != "inaccessible"
		}
	}
	return false
}
func (f *urbanFloodScenario) waiting(id string) bool { return !f.started[id] }

func (f *urbanFloodScenario) planned(before, after []world.Survivor) {
	for i, old := range before {
		if i >= len(after) || old.Status != world.Active || len(old.PlannedRoute) <= 1 {
			continue
		}
		if old.TargetShelterID != after[i].TargetShelterID || !slices.Equal(old.PlannedRoute, after[i].PlannedRoute) {
			f.reroutes++
		}
	}
}

func (f *urbanFloodScenario) finishStep(s *Simulator, elapsed time.Duration) {
	f.performance.SimulationStepLatencyMS = float64(elapsed) / float64(time.Millisecond)
	f.performance.SimulationTotalDurationMS += f.performance.SimulationStepLatencyMS
}

func (f *urbanFloodScenario) snapshot(s *Simulator) *world.ScenarioSnapshot {
	elapsed := math.Min(float64(s.turn)*f.cfg.TimeStep, f.cfg.SimulationDuration)
	w := &world.ScenarioSnapshot{
		ScenarioType: "urban_flood", SimulationStep: s.turn, WorldVersion: s.version, GraphVersion: s.graph.Version,
		SimulationTime: elapsed, SimulationDuration: f.cfg.SimulationDuration, TimeStep: f.cfg.TimeStep,
		Rainfall: f.model.Rainfall(), FloodZones: f.model.Zones(), RoadConditions: append([]world.RoadCondition{}, f.roads...),
		ShelterConditions: append([]world.ShelterCondition{}, f.shelters...), Agents: []world.FloodAgent{}, Performance: f.performance,
		DataProvenance: world.DataProvenance{GraphSource: s.graph.Source, Model: "synthetic-surface-exposure-v1", ElevationSource: "unavailable",
			Disclaimer: "Los escenarios de inundación emplean parámetros sintéticos y no constituyen pronósticos hidrológicos ni recomendaciones oficiales de evacuación", GeographicReference: f.cfg.GeographicReference.Clone()},
	}
	m := &w.EvacuationMetrics
	m.TotalAgents, m.RerouteCount, m.SimulationTotalDuration = len(s.survivors), f.reroutes, elapsed
	for _, v := range s.survivors {
		agent := world.FloodAgent{ID: v.ID, CurrentNode: v.CurrentNode, Behavior: f.cfg.EvacuationBehavior,
			TargetShelterID: v.TargetShelterID, PlannedRoute: append([]string{}, v.PlannedRoute...), State: "moving"}
		switch {
		case v.Status == world.Evacuated:
			agent.State = "evacuated"
			if record := s.diagnostic.records[v.ID]; record != nil {
				agent.EvacuationTime = math.Min(float64(record.EvacuationTurn)*f.cfg.TimeStep, f.cfg.SimulationDuration)
			}
			m.EvacuatedAgents++
			m.AverageEvacuationTime += agent.EvacuationTime
		case f.waiting(v.ID):
			agent.State = "waiting"
			m.WaitingAgents++
		case v.TargetShelterID == "" && len(v.PlannedRoute) <= 1:
			agent.State = "isolated"
			m.IsolatedAgents++
		}
		w.Agents = append(w.Agents, agent)
	}
	if m.EvacuatedAgents > 0 {
		m.AverageEvacuationTime /= float64(m.EvacuatedAgents)
	}
	for _, road := range w.RoadConditions {
		if road.State == "blocked" {
			m.BlockedEdges++
		} else if road.State == "caution" {
			m.CautionEdges++
		}
	}
	for i := range w.ShelterConditions {
		for _, sh := range s.shelters {
			if sh.ID == w.ShelterConditions[i].ShelterID && sh.Occupancy >= sh.Capacity {
				m.SheltersAtCapacity++
				if w.ShelterConditions[i].State == "available" {
					w.ShelterConditions[i].State = "full"
					// Occupancy is terminal in this version, so its first full step
					// is the latest admission among the shelter's occupants.
					for _, agent := range s.survivors {
						if agent.Status == world.Evacuated && agent.TargetShelterID == sh.ID {
							if record := s.diagnostic.records[agent.ID]; record != nil && record.EvacuationTurn > w.ShelterConditions[i].UpdatedAtSimulationStep {
								w.ShelterConditions[i].UpdatedAtSimulationStep = record.EvacuationTurn
							}
						}
					}
				}
			}
		}
	}
	return w
}
