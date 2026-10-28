package simulation

import (
	"fmt"
	"math"
	"sort"

	"corodev/evacuation/internal/diagnostics"
	"corodev/evacuation/internal/world"
)

const fleetSize, vehicleCapacity = 5, 4

func (s *Simulator) initializeFleet() {
	if !s.config.RescueFleet {
		return
	}
	// Deterministic depot convention: approved shelters, ordered by ID, cyclic.
	depots := append([]world.Shelter{}, s.shelters...)
	sort.Slice(depots, func(i, j int) bool { return depots[i].ID < depots[j].ID })
	for i := 0; i < fleetSize; i++ {
		node := depots[i%len(depots)].NodeID
		s.fleet = append(s.fleet, world.RescueVehicle{ID: fmt.Sprintf("V-%02d", i+1), CurrentNode: node, Path: []string{node}, PassengerIDs: []string{}, State: "idle", Capacity: vehicleCapacity, WaitReason: "not_evaluated"})
	}
}

func (s *Simulator) survivorByID(id string) *world.Survivor {
	for i := range s.survivors {
		if s.survivors[i].ID == id {
			return &s.survivors[i]
		}
	}
	return nil
}

// Fleet routes use only currently observable threats. Dormant sleepers and future
// external events do not enter pickup scoring, shelter selection, or routing.
func (s *Simulator) fleetRoute(from, to string) []string {
	danger := s.hordeBlockedNodes()
	opposite := map[traversal]bool{}
	for _, state := range s.zombies {
		z := state.observable
		if !z.Awake {
			continue
		}
		danger[z.CurrentNode] = true
		for i := 1; i < len(z.Path); i++ {
			opposite[traversal{z.Path[i], z.Path[i-1]}] = true
		}
	}
	if danger[to] {
		return nil
	}
	previous := map[string]string{from: ""}
	queue := []string{from}
	for head := 0; head < len(queue); head++ {
		at := queue[head]
		if at == to {
			path := []string{}
			for node := to; node != ""; node = previous[node] {
				path = append(path, node)
			}
			for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
				path[i], path[j] = path[j], path[i]
			}
			return path
		}
		for _, arc := range s.index.Neighbors(at, s.blocked) {
			if danger[arc.To] || opposite[traversal{at, arc.To}] {
				continue
			}
			if _, seen := previous[arc.To]; !seen {
				previous[arc.To] = at
				queue = append(queue, arc.To)
			}
		}
	}
	return nil
}

// Free seats exclude this proposed cohort but include every other active foot or
// onboard reservation. All changes occur under the simulator writer mutex.
func (s *Simulator) fleetFreeSeats(sh world.Shelter, cohort map[string]bool) int {
	free := sh.Capacity - sh.Occupancy
	for _, v := range s.survivors {
		if v.Status == world.Active && v.TargetShelterID == sh.ID && !cohort[v.ID] {
			free--
		}
	}
	return free
}

func (s *Simulator) fleetDestination(node string, passengers []string, preferred string) (string, []string) {
	cohort := map[string]bool{}
	for _, id := range passengers {
		cohort[id] = true
	}
	bestID := ""
	var best []string
	for _, sh := range s.shelters {
		if !s.scenario.admits(sh.ID) || s.fleetFreeSeats(sh, cohort) < len(passengers) {
			continue
		}
		path := s.fleetRoute(node, sh.NodeID)
		if len(path) == 0 {
			continue
		}
		if sh.ID == preferred {
			return sh.ID, path
		}
		if best == nil || len(path) < len(best) || len(path) == len(best) && sh.ID < bestID {
			bestID, best = sh.ID, path
		}
	}
	return bestID, best
}

func (s *Simulator) fleetPickup(v *world.RescueVehicle, claimed map[string]bool) {
	bestScore := math.Inf(-1)
	v.TargetSurvivorID, v.TargetShelterID = "", ""
	active, unclaimed, reachable, deliverable := false, false, false, false
	for _, candidate := range s.survivors {
		if candidate.Status != world.Active || candidate.VehicleID != "" {
			continue
		}
		active = true
		if claimed[candidate.ID] {
			continue
		}
		unclaimed = true
		pickup := s.fleetRoute(v.CurrentNode, candidate.CurrentNode)
		if len(pickup) == 0 {
			continue
		}
		reachable = true
		sh, path := s.fleetDestination(candidate.CurrentNode, []string{candidate.ID}, candidate.TargetShelterID)
		if len(path) > 0 {
			deliverable = true
		}
		if len(path) < 2 {
			continue
		} // Already at a shelter: admission needs no truck.
		pickupETA := math.Ceil(float64(len(pickup)-1) / 2)
		deliveryETA := math.Ceil(float64(len(path)-1) / 2)
		walkingETA := float64(len(path) - 1)
		if deliveryETA >= walkingETA || pickupETA > walkingETA {
			continue
		}
		need := 0.
		for _, state := range s.zombies {
			z := state.observable
			if !z.Awake {
				continue
			}
			if distance, ok := s.distances(z.CurrentNode, 3)[candidate.CurrentNode]; ok {
				need += 4 - float64(distance)
			}
		}
		// The full pickup + delivery ETA matters: depot round trips without
		// exposure or positive time saved are not useful rescue journeys.
		// ID order breaks exact ties, and nonpositive utility stays idle.
		saved := walkingETA - pickupETA - deliveryETA
		score := 4*need + 2*saved - .25*pickupETA
		if score <= 0 {
			continue
		}
		if score > bestScore || score == bestScore && candidate.ID < v.TargetSurvivorID {
			bestScore = score
			v.TargetSurvivorID, v.TargetShelterID = candidate.ID, sh
		}
	}
	if v.TargetSurvivorID != "" {
		claimed[v.TargetSurvivorID] = true
		v.State = "pickup"
		v.WaitReason = ""
	} else {
		v.State = "idle"
		switch {
		case !active:
			v.WaitReason = "no_active_targets"
		case !unclaimed:
			v.WaitReason = "targets_claimed"
		case !reachable:
			v.WaitReason = "no_safe_pickup_route"
		case !deliverable:
			v.WaitReason = "no_available_safe_shelter"
		default:
			v.WaitReason = "no_useful_pickup"
		}
	}
}

func (s *Simulator) fleetBoard(v *world.RescueVehicle, events *[]world.Event) {
	for i := range s.survivors {
		person := &s.survivors[i]
		if len(v.PassengerIDs) >= v.Capacity {
			break
		}
		if person.Status != world.Active || person.VehicleID != "" || person.CurrentNode != v.CurrentNode {
			continue
		}
		var sh world.Shelter
		found := false
		for _, candidate := range s.shelters {
			if candidate.ID == v.TargetShelterID {
				sh, found = candidate, true
				break
			}
		}
		if !found || !s.scenario.admits(sh.ID) || s.fleetFreeSeats(sh, map[string]bool{person.ID: true}) < 1 || len(s.fleetRoute(v.CurrentNode, sh.NodeID)) < 2 {
			continue
		}
		person.VehicleID, person.TargetShelterID = v.ID, sh.ID
		person.PlannedRoute = []string{person.CurrentNode}
		v.PassengerIDs = append(v.PassengerIDs, person.ID)
		s.fleetMetrics.Pickups++
		*events = append(*events, world.Event{Turn: s.turn, Type: "rescue_pickup", EntityID: person.ID, Message: "Pasajero recogido; todavía no evacuado"})
	}
	if len(v.PassengerIDs) > 0 {
		v.TargetSurvivorID = ""
		v.State = "transport"
	}
}

func (s *Simulator) fleetDeliver(v *world.RescueVehicle, events *[]world.Event) bool {
	if len(v.PassengerIDs) == 0 {
		return false
	}
	for i := range s.shelters {
		sh := &s.shelters[i]
		if sh.ID != v.TargetShelterID || sh.NodeID != v.CurrentNode || !s.scenario.admits(sh.ID) {
			continue
		}
		// Admission cannot precede a same-node bite merely because a parked
		// truck has a shelter target. Moving arrivals were checked per segment.
		if _, _, bitten := s.collision(v.CurrentNode, v.CurrentNode); bitten {
			s.fleetPassengerStep(v, v.CurrentNode, v.CurrentNode, events)
			return false
		}
		if sh.Occupancy+len(v.PassengerIDs) > sh.Capacity {
			return false
		}
		for _, id := range v.PassengerIDs {
			person := s.survivorByID(id)
			if person == nil || person.Status != world.Active || person.VehicleID != v.ID {
				continue
			}
			person.Status, person.VehicleID = world.Evacuated, ""
			person.CurrentNode, person.TargetShelterID = sh.NodeID, sh.ID
			person.PlannedRoute = []string{sh.NodeID}
			sh.Occupancy++
			record := s.diagnostic.records[id]
			record.EvacuationTurn = s.turn
			if record.Moves == 0 {
				record.RouteEfficiency = 1
			} else if record.InitialNearestShelterHops >= 0 {
				record.RouteEfficiency = float64(record.InitialNearestShelterHops) / float64(record.Moves)
			}
			s.fleetMetrics.Delivered++
			*events = append(*events, world.Event{Turn: s.turn, Type: "evacuated", EntityID: id, Message: "Pasajero entregado en refugio"})
		}
		s.fleetMetrics.UsefulTrips++
		v.PassengerIDs = []string{}
		v.TargetShelterID, v.TargetSurvivorID, v.State = "", "", "idle"
		s.reconcileReservations()
		return true
	}
	return false
}

func (s *Simulator) fleetPassengerStep(v *world.RescueVehicle, from, to string, events *[]world.Event) {
	living := []string{}
	for _, id := range v.PassengerIDs {
		person := s.survivorByID(id)
		if person == nil || person.Status != world.Active || person.VehicleID != v.ID {
			continue
		}
		person.CurrentNode = to
		record := s.diagnostic.records[id]
		if from != to {
			record.Moves++
			if s.diagnostic.previous[id] == to {
				record.Reversals++
			}
			s.diagnostic.previous[id] = from
		}
		if z, mechanism, bitten := s.collision(from, to); bitten {
			person.Status, person.VehicleID, person.TargetShelterID = world.Bitten, "", ""
			person.PlannedRoute = []string{}
			s.diagnostic.bites = append(s.diagnostic.bites, diagnostics.Bite{Turn: s.turn, SurvivorID: id, ZombieID: z.ID, ZombieType: z.Type, Mechanism: mechanism, From: from, To: to, InitialOverlap: s.diagnostic.initialOverlap[id]})
			*events = append(*events, world.Event{Turn: s.turn, Type: "bitten", EntityID: id, Message: "Pasajero eliminado por coincidencia o cruce opuesto"})
			continue
		}
		living = append(living, id)
	}
	v.PassengerIDs = living
}

func (s *Simulator) moveFleet(events *[]world.Event) {
	if !s.config.RescueFleet {
		return
	}
	claimed := map[string]bool{}
	// Release impossible pickups before ANY vehicle selects a task. Otherwise a
	// later vehicle's stale claim can idle an earlier, reachable rescuer all turn.
	for i := range s.fleet {
		v := &s.fleet[i]
		person := s.survivorByID(v.TargetSurvivorID)
		valid := len(v.PassengerIDs) == 0 && person != nil && person.Status == world.Active && person.VehicleID == "" && !claimed[person.ID]
		if valid {
			_, delivery := s.fleetDestination(person.CurrentNode, []string{person.ID}, v.TargetShelterID)
			valid = len(delivery) > 1 && len(s.fleetRoute(v.CurrentNode, person.CurrentNode)) > 0
		}
		if !valid {
			v.TargetSurvivorID = ""
			if len(v.PassengerIDs) == 0 {
				v.TargetShelterID = ""
			}
		} else {
			claimed[person.ID] = true
		}
	}
	for i := range s.fleet {
		v := &s.fleet[i]
		v.Path = []string{v.CurrentNode}
		v.WaitReason = ""
		for moves := 0; moves <= 2; moves++ {
			s.fleetDeliver(v, events)
			if len(v.PassengerIDs) == 0 {
				target := s.survivorByID(v.TargetSurvivorID)
				if target == nil || target.Status != world.Active || target.VehicleID != "" || len(s.fleetRoute(v.CurrentNode, target.CurrentNode)) == 0 {
					delete(claimed, v.TargetSurvivorID)
					s.fleetPickup(v, claimed)
					target = s.survivorByID(v.TargetSurvivorID)
				}
				if target != nil && target.CurrentNode == v.CurrentNode {
					s.fleetBoard(v, events)
				}
			}
			var path []string
			if len(v.PassengerIDs) > 0 {
				v.TargetShelterID, path = s.fleetDestination(v.CurrentNode, v.PassengerIDs, v.TargetShelterID)
				for _, id := range v.PassengerIDs {
					if person := s.survivorByID(id); person != nil {
						person.TargetShelterID = v.TargetShelterID
					}
				}
				v.State = "transport"
				if len(path) == 0 {
					v.State = "waiting"
					v.WaitReason = "no_available_safe_shelter"
				}
			} else if target := s.survivorByID(v.TargetSurvivorID); target != nil && target.Status == world.Active && target.VehicleID == "" {
				// Recheck destination viability every turn: a full refuge cancels
				// an empty pickup trip before it consumes additional road moves.
				sh, delivery := s.fleetDestination(target.CurrentNode, []string{target.ID}, v.TargetShelterID)
				if len(delivery) > 1 {
					v.TargetShelterID = sh
					v.State = "pickup"
					path = s.fleetRoute(v.CurrentNode, target.CurrentNode)
				} else {
					delete(claimed, v.TargetSurvivorID)
					v.TargetSurvivorID, v.TargetShelterID, v.State = "", "", "idle"
					v.WaitReason = "no_available_safe_shelter"
				}
			}
			if moves == 2 || len(path) < 2 {
				// Waiting passengers remain exposed at the actual node.
				s.fleetPassengerStep(v, v.CurrentNode, v.CurrentNode, events)
				break
			}
			from, to := v.CurrentNode, path[1]
			if !s.index.CanMove(from, to, s.blocked) || s.hordeBlockedNodes()[to] {
				v.State = "waiting"
				v.WaitReason = "blocked_movement"
				break
			}
			v.CurrentNode = to
			v.Path = append(v.Path, to)
			s.fleetMetrics.Moves++
			s.fleetPassengerStep(v, from, to, events)
		}
	}
	s.reconcileReservations()
}
