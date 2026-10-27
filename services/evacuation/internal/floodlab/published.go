package floodlab

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"
)

// These presentation controls intentionally require no operator identity. The
// other write capabilities (moderation and official reference refresh) retain
// their original authorization, while every route retains host/origin checks.
func lifecycleRoute(path string) bool {
	switch path {
	case "/lab/runs", "/lab/actions", "/lab/candidates/validate", "/lab/comparisons":
		return true
	default:
		return false
	}
}

type lifecycleRate struct {
	window   time.Time
	requests int
	starts   int
}

func (m *Manager) allowLifecycle(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	bucket, ok := m.lifecycleRates[host]
	if !ok && len(m.lifecycleRates) >= 1024 {
		for id, entry := range m.lifecycleRates {
			if now.Sub(entry.window) >= time.Minute {
				delete(m.lifecycleRates, id)
			}
		}
		if len(m.lifecycleRates) >= 1024 {
			return false
		}
	}
	if !ok || now.Sub(bucket.window) >= time.Minute {
		bucket = lifecycleRate{window: now}
	}
	starting := r.URL.Path == "/lab/runs" || r.URL.Path == "/lab/comparisons"
	if bucket.requests >= 120 || starting && bucket.starts >= 10 {
		return false
	}
	bucket.requests++
	if starting {
		bucket.starts++
	}
	m.lifecycleRates[host] = bucket
	return true
}

// Reuse the authoritative laboratory run, omitting historical timeline and A/B
// jobs. JSON is encoded only once per published version, regardless of viewers.
func (m *Manager) servePublished(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	key := fmt.Sprintf("%s/%s/%d/%d", m.state.RunID, m.state.State, m.state.Scenario.WorldVersion, m.state.Config.IntervalMS)
	if m.publicBytes == nil || m.publicKey != key {
		state := m.state
		state.Timeline = []TimelineEntry{}
		state.Comparison = nil
		encoded, err := json.Marshal(state)
		if err != nil {
			m.mu.Unlock()
			fail(w, 500, "INTERNAL_ERROR", "No pudo consultarse la ejecución publicada.")
			return
		}
		digest := sha256.Sum256(encoded)
		m.publicBytes, m.publicKey = encoded, key
		m.publicETag = fmt.Sprintf(`"%x"`, digest[:16])
	}
	encoded, etag := m.publicBytes, m.publicETag
	m.mu.Unlock()
	w.Header().Set("ETag", etag)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(encoded)
}
