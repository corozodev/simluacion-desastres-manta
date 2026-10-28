package sessions

import (
	"crypto/rand"
	"math/big"

	"corodev/evacuation/internal/simulation"
)

const maxSafeInteger = 9007199254740991

// A conservative incremental reservation for mutable state, observable copies,
// diagnostics, prediction and retained snapshots. This is not a measured SLA.
const zombieReservation int64 = 16 << 10

func automaticSeed() (int64, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(maxSafeInteger+1))
	if err != nil {
		return 0, err
	}
	return n.Int64(), nil
}

func (m *Manager) generation(req CreateRequest) (simulation.ZombieCounts, int64, error) {
	if req.Scenario == "urban_flood" {
		if req.Config.ZombieCounts != nil {
			return simulation.ZombieCounts{}, 0, &Error{400, "VALIDATION_ERROR", "zombie_counts sólo se admite en brotes zombie."}
		}
		return simulation.ZombieCounts{}, reservation(req.GraphProfile), nil
	}
	round := req.Config.Round
	if round == "" {
		round = "round1"
	}
	cfg, err := m.catalog.Config(profileMode(req.GraphProfile), round, nil)
	if err != nil {
		return simulation.ZombieCounts{}, 0, invalid()
	}
	counts := cfg.ZombieCounts()
	if req.Config.ZombieCounts != nil {
		counts = *req.Config.ZombieCounts
	}
	for _, entry := range []struct {
		name     string
		n        int
		required bool
	}{
		{"walker", counts.Walker, true},
		{"runner", counts.Runner, round != "round1"},
		{"horde", counts.Horde, round != "round1"},
		{"sleeper", counts.Sleeper, round == "round3"},
	} {
		if entry.n < 0 || int64(entry.n) > maxSafeInteger || entry.required && entry.n == 0 || !entry.required && entry.n != 0 {
			return simulation.ZombieCounts{}, 0, &Error{400, "VALIDATION_ERROR", "zombie_counts." + entry.name + ": exige un entero positivo si la ronda incluye el tipo, o cero si lo excluye."}
		}
	}
	// Defaults already fit the historical graph reservation. Extra population
	// must fit the existing process budget before any engine allocation.
	extra := max(int64(0), counts.Total()-cfg.ZombieCounts().Total())
	base := reservation(req.GraphProfile)
	if extra > 0 && (base > m.options.MaxMemoryBytes || extra > (m.options.MaxMemoryBytes-base)/zombieReservation) {
		return simulation.ZombieCounts{}, 0, &Error{400, "VALIDATION_ERROR", "La población zombie solicitada excede el presupuesto de memoria de este perfil. Reduce las cantidades."}
	}
	return counts, base + extra*zombieReservation, nil
}
