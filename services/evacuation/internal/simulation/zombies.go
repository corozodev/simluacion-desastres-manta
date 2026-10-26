package simulation

import "corodev/evacuation/internal/world"

func (s *Simulator) moveZombies(events *[]world.Event) {
	for i := range s.zombies {
		state := &s.zombies[i]
		z := &state.observable
		z.Path = []string{z.CurrentNode}
		z.MovementState = "resting"
		if !z.Awake {
			near := s.distances(z.CurrentNode, 2)
			for _, v := range s.survivors {
				if v.Status == world.Active {
					if _, ok := near[v.CurrentNode]; ok {
						z.Awake = true
						state.awakeTurns = 0
						*events = append(*events, world.Event{Turn: s.turn, Type: "sleeper_awake", EntityID: z.ID, Message: "Sleeper became observable"})
						break
					}
				}
			}
			if !z.Awake {
				continue
			}
		}
		state.awakeTurns++
		switch z.Type {
		case world.Walker, world.Sleeper:
			if state.awakeTurns%2 == 0 {
				s.wander(z, 1)
			}
		case world.Runner:
			detection := s.distances(z.CurrentNode, 3)
			var best []string
			bestDistance := 4
			// Survivors are sorted by ID; ties deliberately keep the first.
			for _, v := range s.survivors {
				d, detected := detection[v.CurrentNode]
				if v.Status != world.Active || !detected || d >= bestDistance {
					continue
				}
				if route := s.route(z.CurrentNode, v.CurrentNode); len(route) > 0 {
					best, bestDistance = route, d
				}
			}
			if len(best) == 0 {
				s.wander(z, 2)
			} else {
				if len(best) > 3 {
					best = best[:3]
				}
				z.Path = append([]string{}, best...)
				z.CurrentNode = best[len(best)-1]
				if len(best) > 1 {
					z.MovementState = "chasing"
				}
			}
		case world.Horde:
			if s.config.HordeMoveEvery > 0 && state.awakeTurns%s.config.HordeMoveEvery == 0 {
				s.wander(z, 1)
			}
		}
	}
}

func (s *Simulator) wander(z *world.Zombie, steps int) {
	for i := 0; i < steps; i++ {
		neighbors := s.index.Neighbors(z.CurrentNode, s.blocked)
		if len(neighbors) == 0 {
			return
		}
		z.CurrentNode = neighbors[s.rng.Intn(len(neighbors))].To
		z.Path = append(z.Path, z.CurrentNode)
		z.MovementState = "moving"
	}
}

// Detection is physical graph proximity, independent of traffic direction and
// closures. Movement routes still honor both directions and all road closures.
func (s *Simulator) distances(from string, limit int) map[string]int {
	distance := map[string]int{from: 0}
	queue := []string{from}
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		if distance[n] >= limit {
			continue
		}
		for _, next := range s.proximity[n] {
			if _, seen := distance[next]; !seen {
				distance[next] = distance[n] + 1
				queue = append(queue, next)
			}
		}
	}
	return distance
}

func (s *Simulator) route(from, to string) []string {
	previous := map[string]string{from: ""}
	queue := []string{from}
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		if n == to {
			path := []string{}
			for current := to; current != ""; current = previous[current] {
				path = append(path, current)
			}
			for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
				path[i], path[j] = path[j], path[i]
			}
			return path
		}
		for _, arc := range s.index.Neighbors(n, s.blocked) {
			if _, seen := previous[arc.To]; !seen {
				previous[arc.To] = n
				queue = append(queue, arc.To)
			}
		}
	}
	return nil
}
