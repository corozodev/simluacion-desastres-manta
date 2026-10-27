package simulation

import (
	"math"

	"corodev/evacuation/internal/graph"
)

const (
	ClassicRandom        = "classic_random"
	CorrelatedRandomWalk = "correlated_random_walk"
	AdaptiveExploration  = "adaptive_exploration"
)

// movementMemory belongs to one zombie in one simulator. No hidden memory is
// published to observers. A recent-node window bounds space at O(16) per agent.
type movementMemory struct {
	previous  string
	recent    []string
	headingX  float64
	headingY  float64
	remaining int
}

type movementPolicy interface {
	choose(*Simulator, *zombieState, []graph.Arc) int
}

type classicPolicy struct{}
type persistentPolicy struct{ explore bool }

func (classicPolicy) choose(s *Simulator, _ *zombieState, neighbors []graph.Arc) int {
	// Keep exactly one Intn per step, including degree-one streets. This is the
	// original RNG consumption and preserves historical baseline trajectories.
	return s.rng.Intn(len(neighbors))
}

func (p persistentPolicy) choose(s *Simulator, state *zombieState, neighbors []graph.Arc) int {
	m := &state.memory
	at, _ := s.index.Node(state.observable.CurrentNode)
	previous, hasPrevious := s.index.Node(m.previous)
	hx, hy := at.Lng-previous.Lng, at.Lat-previous.Lat
	if !hasPrevious {
		hx, hy = 0, 0
	}
	if p.explore {
		if m.remaining <= 0 {
			goal, _ := s.index.Node(neighbors[s.rng.Intn(len(neighbors))].To)
			m.headingX, m.headingY = goal.Lng-at.Lng, goal.Lat-at.Lat
			// A bounded stochastic run length references persistent/Lévy-like
			// exploration without adding long jumps or changing cadence/speed.
			m.remaining = 1
			for m.remaining < 8 && s.rng.Float64() < .65 {
				m.remaining++
			}
		}
		hx, hy = m.headingX, m.headingY
		m.remaining--
	}
	weights := make([]float64, len(neighbors))
	total := 0.
	for i, arc := range neighbors {
		next, _ := s.index.Node(arc.To)
		dx, dy := next.Lng-at.Lng, next.Lat-at.Lat
		denominator := math.Hypot(hx, hy) * math.Hypot(dx, dy)
		alignment := 0.
		if denominator > 0 {
			alignment = (hx*dx + hy*dy) / denominator
		}
		weight := math.Exp(1.4 * alignment)
		if p.explore {
			visits := 0
			for _, node := range m.recent {
				if node == arc.To {
					visits++
				}
			}
			weight /= 1 + float64(visits)
		}
		// Positive weight permits legitimate backtracking, even at junctions.
		weights[i], total = weight, total+weight
	}
	draw := s.rng.Float64() * total
	for i, weight := range weights {
		draw -= weight
		if draw < 0 {
			return i
		}
	}
	return len(neighbors) - 1
}

func (s *Simulator) movementPolicy() movementPolicy {
	switch s.config.ZombiePolicy {
	case CorrelatedRandomWalk:
		return persistentPolicy{}
	case AdaptiveExploration:
		return persistentPolicy{explore: true}
	default:
		return classicPolicy{}
	}
}

func (s *Simulator) rememberMovement(state *zombieState, from string) {
	if s.config.ZombiePolicy == ClassicRandom {
		return
	}
	m := &state.memory
	m.previous = from
	m.recent = append(m.recent, from)
	if len(m.recent) > 16 {
		m.recent = m.recent[len(m.recent)-16:]
	}
}
