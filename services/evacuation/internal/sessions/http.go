package sessions

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"
	"time"
)

func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, err error) {
	e, ok := err.(*Error)
	if !ok {
		e = &Error{500, "INTERNAL_ERROR", "No se pudo procesar la solicitud."}
	}
	jsonResponse(w, e.Status, map[string]any{"error": map[string]any{"code": e.Code, "message": e.Message, "requestId": w.Header().Get("x-request-id"), "details": []any{}}})
}
func remoteActor(r *http.Request) string {
	// No forwarded header is trusted. This remains safe behind unconfigured
	// proxies, at the expense of sharing their per-IP quota.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return "unknown"
	}
	return ip.String()
}
func (m *Manager) allow(actor string, create bool) bool {
	now := m.options.Clock.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.rates[actor]
	if !ok && len(m.rates) >= 1024 {
		for id, entry := range m.rates {
			if now.Sub(entry.window) >= time.Minute {
				delete(m.rates, id)
			}
		}
		if len(m.rates) >= 1024 {
			return false
		}
	}
	if !ok || now.Sub(b.window) >= time.Minute {
		b = rateBucket{window: now}
	}
	if b.requests >= m.options.RateLimitPerMinute || create && b.creates >= m.options.CreateLimitPerMinute {
		return false
	}
	b.requests++
	if create {
		b.creates++
	}
	m.rates[actor] = b
	return true
}

func (m *Manager) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id, err := randomSecret(16)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("x-request-id", id)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	defer func() {
		if recover() != nil {
			m.options.Logger.Error("simulation_http_failed", "request_id", id)
			fail(w, fmt.Errorf("request failed"))
		}
	}()
	if origin := r.Header.Get("Origin"); origin != "" {
		w.Header().Add("Vary", "Origin")
		allowed := false
		for _, o := range m.options.Origins {
			if strings.TrimSpace(o) == origin {
				allowed = true
				break
			}
		}
		if !allowed {
			fail(w, &Error{403, "UNAUTHORIZED", "Origen no autorizado."})
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Expose-Headers", "x-request-id, ETag, Retry-After")
	}
	if r.Method == http.MethodOptions {
		if r.Header.Get("Origin") == "" {
			fail(w, &Error{403, "UNAUTHORIZED", "Origen no autorizado."})
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, If-None-Match")
		w.WriteHeader(204)
		return
	}
	actor := remoteActor(r)
	creating := r.Method == "POST" && (r.URL.Path == "/v1/simulations" || strings.HasSuffix(r.URL.Path, "/restart"))
	if !m.allow(actor, creating) {
		w.Header().Set("Retry-After", "60")
		fail(w, &Error{429, "RATE_LIMITED", "Demasiadas solicitudes. Intenta en un minuto."})
		return
	}
	if r.URL.Path == "/metrics" {
		if r.Method != "GET" {
			methodError(w, "GET")
			return
		}
		m.serveMetrics(w)
		return
	}
	if r.URL.Path == "/v1/simulations/capabilities" {
		if r.Method != "GET" {
			methodError(w, "GET")
			return
		}
		jsonResponse(w, 200, m.capabilities())
		return
	}
	if r.URL.Path == "/v1/simulations" {
		if r.Method != "POST" {
			methodError(w, "POST")
			return
		}
		req, err := decodeCreate(w, r)
		if err != nil {
			fail(w, err)
			return
		}
		i, err := m.CreateAndStart(r.Context(), req, r.Header.Get("Idempotency-Key"), actor)
		if err != nil {
			fail(w, err)
			return
		}
		jsonResponse(w, 201, i)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/simulations/"), "/")
	if !strings.HasPrefix(r.URL.Path, "/v1/simulations/") || len(parts) < 1 || len(parts) > 2 || len(parts[0]) != 32 {
		fail(w, &Error{404, "NOT_FOUND", "Recurso no encontrado."})
		return
	}
	credential := r.Header.Get("Authorization")
	if !strings.HasPrefix(credential, "Bearer ") || len(credential) != 50 {
		fail(w, &Error{401, "UNAUTHORIZED", "Se requiere una credencial de simulación."})
		return
	}
	token := strings.TrimPrefix(credential, "Bearer ")
	simulationID := parts[0]
	action := ""
	if len(parts) == 2 {
		action = parts[1]
	}
	if action == "" || action == "state" || action == "results" {
		if r.Method != "GET" {
			methodError(w, "GET")
			return
		}
		if action == "" {
			i, err := m.Get(simulationID, token)
			if err != nil {
				fail(w, err)
				return
			}
			jsonResponse(w, 200, i)
			return
		}
		state, err := m.GetSnapshot(simulationID, token, action == "results")
		if err != nil {
			fail(w, err)
			return
		}
		// Logical state equivalence: authenticated polling may refresh the idle
		// lease metadata without changing the authoritative tick or lifecycle.
		etag := fmt.Sprintf(`W/"%s-%d"`, state.SimulationID, state.StateVersion)
		w.Header().Set("ETag", etag)
		if action == "state" && r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(304)
			return
		}
		jsonResponse(w, 200, state)
		return
	}
	if action != "pause" && action != "resume" && action != "cancel" && action != "restart" {
		fail(w, &Error{404, "NOT_FOUND", "Recurso no encontrado."})
		return
	}
	if r.Method != "POST" {
		methodError(w, "POST")
		return
	}
	// Authenticate before validating control-specific input, including restart
	// idempotency. Invalid credentials cannot extend idle deadlines.
	if _, err := m.lookup(simulationID, token, false); err != nil {
		fail(w, err)
		return
	}
	if r.Body != nil && r.ContentLength != 0 {
		var value map[string]json.RawMessage
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		if d.Decode(&value) != nil || len(value) > 0 || d.Decode(new(any)) != io.EOF {
			fail(w, invalid())
			return
		}
	}
	var info Metadata
	if action == "restart" {
		info, err = m.Restart(r.Context(), simulationID, token, r.Header.Get("Idempotency-Key"), actor)
	} else {
		info, err = m.Control(simulationID, token, action)
	}
	if err != nil {
		fail(w, err)
		return
	}
	status := 200
	if action == "restart" {
		status = 201
	}
	jsonResponse(w, status, info)
}

func methodError(w http.ResponseWriter, method string) {
	w.Header().Set("Allow", method)
	fail(w, &Error{405, "METHOD_NOT_ALLOWED", "Método no permitido."})
}

func decodeCreate(w http.ResponseWriter, r *http.Request) (CreateRequest, error) {
	var req CreateRequest
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return req, invalid()
	}
	var raw map[string]json.RawMessage
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	if d.Decode(&raw) != nil || raw == nil || d.Decode(new(any)) != io.EOF {
		return req, invalid()
	}
	allowed := map[string]bool{"scenario": true, "graph_profile": true, "seed": true, "max_ticks": true, "tick_interval_ms": true, "config": true}
	for k, v := range raw {
		if !allowed[k] || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
			return req, invalid()
		}
	}
	if config, ok := raw["config"]; ok {
		var fields map[string]json.RawMessage
		if json.Unmarshal(config, &fields) != nil {
			return req, invalid()
		}
		allowedConfig := map[string]bool{"survivors": true, "round": true, "refuge_ids": true, "rainfall_intensity": true, "custom_shelters": true}
		for k, v := range fields {
			if !allowedConfig[k] || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
				return req, invalid()
			}
		}
	}
	encoded, _ := json.Marshal(raw)
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&req) != nil {
		return req, invalid()
	}
	return req, nil
}

func (m *Manager) capabilities() any {
	profiles := []any{}
	for _, id := range []string{"BASE", "FULL_MANTA"} {
		p, _ := m.catalog.Preset(profileMode(id))
		available := p.Enabled
		if id == "FULL_MANTA" && m.options.MaxFullActive == 0 {
			available = false
		}
		profiles = append(profiles, map[string]any{"id": id, "name": p.Name, "available": available, "graph_version": p.GraphVersion, "nodes": p.Nodes, "edges": p.Edges, "disabled_reason": p.DisabledReason})
	}
	return map[string]any{
		"scenarios":      []any{map[string]any{"id": "zombie_outbreak", "name": "Brote zombie", "available": true, "synthetic": true}, map[string]any{"id": "urban_flood", "name": "Inundación urbana simulada", "available": true, "synthetic": true}},
		"graph_profiles": profiles, "rounds": m.catalog.Rounds(),
		"defaults": map[string]any{"scenario": "zombie_outbreak", "graph_profile": "BASE", "seed": 20261026, "max_ticks": m.options.DefaultMaxTicks, "tick_interval_ms": m.options.DefaultTickInterval.Milliseconds(), "survivors": 20, "round": "round1"},
		"limits":   map[string]any{"max_active": m.options.MaxActive, "max_full_active": m.options.MaxFullActive, "max_retained": m.options.MaxRetained, "max_memory_bytes": m.options.MaxMemoryBytes, "min_tick_interval_ms": 1000, "max_tick_interval_ms": 5000, "max_ticks": 150, "max_survivors": 200},
	}
}

func (m *Manager) serveMetrics(w http.ResponseWriter) {
	v := m.Stats()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = fmt.Fprintf(w, "manta_simulation_active_sessions %d\nmanta_simulation_retained_sessions %d\nmanta_simulation_completed_total %d\nmanta_simulation_rejected_total %d\nmanta_simulation_engine_errors_total %d\nmanta_simulation_estimated_memory_bytes %d\nmanta_simulation_turns_total %d\nmanta_simulation_turn_duration_ms_total %g\nmanta_simulation_duration_ms_total %g\n", v.Active, v.Retained, v.Completed, v.Rejected, v.EngineErrors, v.EstimatedMemoryBytes, v.Turns, v.TurnDurationMS, v.ExecutionDurationMS)
}
