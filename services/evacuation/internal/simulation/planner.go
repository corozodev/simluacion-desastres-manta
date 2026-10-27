package simulation

import (
	"context"
	"time"

	"corodev/evacuation/internal/world"
)

// SetPlanner installs the single-writer planning phase before Run.
func (s *Simulator) SetPlanner(planner world.TurnPlanner) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.planner = planner
	if planner != nil {
		s.prepare(context.Background(), nil)
		s.publish(nil)
	}
}

func (s *Simulator) prepare(ctx context.Context, events []world.Event) {
	if s.planner == nil {
		return
	}
	started := time.Now()
	defer func() {
		elapsed := time.Since(started)
		s.diagnostic.planning = append(s.diagnostic.planning, elapsed)
		if f, ok := s.scenario.(*urbanFloodScenario); ok {
			f.planningMS = float64(elapsed) / float64(time.Millisecond)
			f.planningCalls++
		}
	}()
	before := s.observable(events).Clone()
	// Passengers reserve real shelter seats but do not receive pedestrian plans.
	// Keep their observable positions as possible runner prey, and charge their
	// seats as effective occupancy only in the planner input.
	passengerReservations := map[string]int{}
	if s.config.RescueFleet {
		for _, person := range before.Survivors {
			if person.Status == world.Active && person.VehicleID != "" {
				if person.TargetShelterID != "" {
					passengerReservations[person.TargetShelterID]++
				}
			}
		}
		for i := range before.Shelters {
			before.Shelters[i].Occupancy += passengerReservations[before.Shelters[i].ID]
		}
	}
	// These are invalidated observable routes, not private engine cache misses.
	danger := s.hordeBlockedNodes()
	for _, z := range before.Zombies {
		danger[z.CurrentNode] = true
	}
	for _, v := range s.survivors {
		invalid := false
		for i := 1; i < len(v.PlannedRoute); i++ {
			if !s.index.CanMove(v.PlannedRoute[i-1], v.PlannedRoute[i], s.blocked) || danger[v.PlannedRoute[i]] {
				invalid = true
				break
			}
		}
		if invalid {
			s.diagnostic.records[v.ID].RouteInvalidations++
		}
	}
	planned := s.planner.Prepare(ctx, before)
	byID := map[string]world.Survivor{}
	for _, v := range planned.Survivors {
		byID[v.ID] = v
	}
	shelters := map[string]world.Shelter{}
	for _, sh := range s.shelters {
		shelters[sh.ID] = sh
	}
	assigned := passengerReservations
	for i := range s.survivors {
		v := &s.survivors[i]
		if v.Status != world.Active {
			continue
		}
		if v.VehicleID != "" {
			v.PlannedRoute = []string{v.CurrentNode}
			continue
		}
		if s.scenario.waiting(v.ID) {
			v.TargetShelterID = ""
			v.PlannedRoute = []string{v.CurrentNode}
			continue
		}
		proposal, ok := byID[v.ID]
		if !ok {
			v.TargetShelterID = ""
			v.PlannedRoute = []string{}
			continue
		}
		sh, hasShelter := shelters[proposal.TargetShelterID]
		route := proposal.PlannedRoute
		valid := len(route) > 0 && route[0] == v.CurrentNode
		for j := 1; j < len(route) && valid; j++ {
			valid = s.index.CanMove(route[j-1], route[j], s.blocked)
		}
		if proposal.TargetShelterID != "" {
			valid = valid && hasShelter && s.scenario.admits(sh.ID) && assigned[sh.ID] < sh.Capacity-sh.Occupancy && route[len(route)-1] == sh.NodeID
		}
		if !valid {
			v.TargetShelterID = ""
			v.PlannedRoute = []string{}
			continue
		}
		v.TargetShelterID = proposal.TargetShelterID
		v.PlannedRoute = append([]string{}, route...)
		if hasShelter {
			assigned[sh.ID]++
		}
	}
	s.scenario.planned(before.Survivors, s.survivors)
	s.reconcileReservations()
}

func trimRoute(route []string, node string) []string {
	for i, at := range route {
		if at == node {
			return append([]string{}, route[i:]...)
		}
	}
	return []string{}
}

func (s *Simulator) reconcileReservations() {
	reserved := map[string]int{}
	for _, v := range s.survivors {
		if v.Status == world.Active && v.TargetShelterID != "" {
			reserved[v.TargetShelterID]++
		}
	}
	for i := range s.shelters {
		sh := &s.shelters[i]
		sh.Reserved = reserved[sh.ID]
		sh.Available = sh.Capacity - sh.Occupancy - sh.Reserved
		if sh.Available < 0 {
			sh.Available = 0
		}
	}
}
