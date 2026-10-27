package sessions

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Published contains no capability to mutate an execution. Geography is fetched
// once through the existing graph endpoint, outside these compact snapshots.
type Published struct {
	Scenario     string `json:"scenario"`
	Availability string `json:"availability"`
	Simulation   *State `json:"simulation,omitempty"`
}

// Spectators have a separate bounded quota so a shared NAT or reverse proxy
// cannot exhaust the existing controller request budget simply by observing.
func (m *Manager) allowPublic(actor string) bool {
	now := m.options.Clock.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	bucket, ok := m.publicRates[actor]
	if !ok && len(m.publicRates) >= 1024 {
		for id, entry := range m.publicRates {
			if now.Sub(entry.window) >= time.Minute {
				delete(m.publicRates, id)
			}
		}
		if len(m.publicRates) >= 1024 {
			return false
		}
	}
	if !ok || now.Sub(bucket.window) >= time.Minute {
		bucket = rateBucket{window: now}
	}
	if bucket.requests >= m.options.RateLimitPerMinute*50 {
		return false
	}
	bucket.requests++
	m.publicRates[actor] = bucket
	return true
}

func (m *Manager) servePublished(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodError(w, http.MethodGet)
		return
	}
	scenario := strings.TrimPrefix(r.URL.Path, "/v1/simulations/published/")
	if scenario != "zombie_outbreak" && scenario != "urban_flood" {
		fail(w, &Error{400, "VALIDATION_ERROR", "El escenario publicado no es válido."})
		return
	}
	if !m.allowPublic(remoteActor(r)) {
		w.Header().Set("Retry-After", "60")
		fail(w, &Error{429, "RATE_LIMITED", "Demasiadas consultas. Intenta en un minuto."})
		return
	}
	m.mu.Lock()
	id := m.published[scenario]
	s := m.sessions[id]
	closed := m.closed
	m.mu.Unlock()
	publication := Published{Scenario: scenario, Availability: "none"}
	if id != "" || closed {
		publication.Availability = "unavailable"
	}
	if s == nil || closed {
		jsonResponse(w, http.StatusOK, publication)
		return
	}
	// Never refresh lastAccess: opening a viewer cannot extend capacity leases,
	// advance a turn, consume randomness, or resurrect an expired simulation.
	s.mu.Lock()
	if s.expired || !m.options.Clock.Now().Before(m.expiryLocked(s)) {
		s.mu.Unlock()
		jsonResponse(w, http.StatusOK, publication)
		return
	}
	if s.publicBytes == nil || s.publicVersion != s.info.StateVersion {
		state := snapshotLocked(s, terminal(s.info.Status))
		publication.Availability, publication.Simulation = "available", &state
		encoded, err := json.Marshal(publication)
		if err != nil {
			s.mu.Unlock()
			fail(w, err)
			return
		}
		digest := sha256.Sum256(encoded)
		s.publicBytes = encoded
		s.publicVersion = s.info.StateVersion
		s.publicETag = fmt.Sprintf(`"%x"`, digest[:16])
	}
	encoded, etag := s.publicBytes, s.publicETag
	s.mu.Unlock()
	w.Header().Set("ETag", etag)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(encoded)
}
