package floodlab

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type localSession struct {
	csrf    string
	expires time.Time
}
type localSessions struct {
	mu    sync.Mutex
	items map[string]localSession
}
type Session struct {
	Enabled       bool   `json:"enabled"`
	Authenticated bool   `json:"authenticated"`
	CSRFToken     string `json:"csrf_token"`
}

func token() (string, error) {
	var value [32]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value[:]), nil
}
func sessionKey(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func loopbackHost(value string) bool {
	host, _, err := net.SplitHostPort(value)
	if err != nil {
		host = value
	}
	host = strings.Trim(host, "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (m *Manager) allowedOrigin(value string) bool {
	for _, origin := range m.origins {
		if value != "" && strings.TrimSpace(origin) == value {
			return true
		}
	}
	return false
}

func (m *Manager) session(w http.ResponseWriter, r *http.Request) (Session, error) {
	now := time.Now()
	m.sessions.mu.Lock()
	defer m.sessions.mu.Unlock()
	for key, entry := range m.sessions.items {
		if !now.Before(entry.expires) {
			delete(m.sessions.items, key)
		}
	}
	if cookie, err := r.Cookie("corodev_flood_lab"); err == nil {
		if entry, ok := m.sessions.items[sessionKey(cookie.Value)]; ok {
			return Session{Enabled: true, Authenticated: true, CSRFToken: entry.csrf}, nil
		}
	}
	value, err := token()
	if err != nil {
		return Session{}, err
	}
	csrf, err := token()
	if err != nil {
		return Session{}, err
	}
	if len(m.sessions.items) >= 16 {
		oldest := ""
		var expiry time.Time
		for key, item := range m.sessions.items {
			if expiry.IsZero() || item.expires.Before(expiry) {
				oldest, expiry = key, item.expires
			}
		}
		delete(m.sessions.items, oldest)
	}
	m.sessions.items[sessionKey(value)] = localSession{csrf: csrf, expires: now.Add(time.Hour)}
	http.SetCookie(w, &http.Cookie{Name: "corodev_flood_lab", Value: value, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 3600, Expires: now.Add(time.Hour)})
	return Session{Enabled: true, Authenticated: true, CSRFToken: csrf}, nil
}

func (m *Manager) authorized(r *http.Request) bool {
	if !m.allowedOrigin(r.Header.Get("Origin")) {
		return false
	}
	cookie, err := r.Cookie("corodev_flood_lab")
	if err != nil {
		return false
	}
	m.sessions.mu.Lock()
	defer m.sessions.mu.Unlock()
	entry, ok := m.sessions.items[sessionKey(cookie.Value)]
	if !ok || !time.Now().Before(entry.expires) {
		return false
	}
	left, right := sha256.Sum256([]byte(entry.csrf)), sha256.Sum256([]byte(r.Header.Get("X-CSRF-Token")))
	return subtle.ConstantTimeCompare(left[:], right[:]) == 1
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message, "requestId": w.Header().Get("x-request-id"), "details": []any{}}})
}

func decode(w http.ResponseWriter, r *http.Request, destination any) bool {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		fail(w, 400, "VALIDATION_ERROR", "Se requiere un cuerpo JSON válido.")
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768))
	var raw json.RawMessage
	if d.Decode(&raw) != nil || d.Decode(new(any)) != io.EOF {
		fail(w, 400, "VALIDATION_ERROR", "Revisa los campos enviados.")
		return false
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	if strict.Decode(destination) != nil || !requiredInput(raw, destination) {
		fail(w, 400, "VALIDATION_ERROR", "Revisa los campos obligatorios enviados.")
		return false
	}
	return true
}

func requiredObject(raw json.RawMessage, keys ...string) (map[string]json.RawMessage, bool) {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return nil, false
	}
	for _, value := range object {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return nil, false
		}
	}
	for _, key := range keys {
		if _, ok := object[key]; !ok {
			return nil, false
		}
	}
	return object, true
}

func requiredCandidates(raw json.RawMessage) bool {
	var candidates []json.RawMessage
	if json.Unmarshal(raw, &candidates) != nil || candidates == nil {
		return false
	}
	for _, candidate := range candidates {
		if _, ok := requiredObject(candidate, "id", "label", "lat", "lng", "capacity"); !ok {
			return false
		}
	}
	return true
}

func requiredInput(raw json.RawMessage, destination any) bool {
	switch destination.(type) {
	case *RunRequest:
		body, ok := requiredObject(raw, "config", "expected_run_id")
		if !ok {
			return false
		}
		cfg, ok := requiredObject(body["config"], "mode", "seed", "rainfall_profile", "rainfall_intensity", "simulation_duration", "evacuation_behavior", "agents", "interval_ms", "shelters")
		if ref, present := cfg["geographic_reference"]; present {
			if _, valid := requiredObject(ref, "enabled", "strength"); !valid {
				return false
			}
		}
		return ok && requiredCandidates(cfg["shelters"])
	case *Action:
		_, ok := requiredObject(raw, "action", "expected_run_id")
		return ok
	case *CandidateRequest:
		body, ok := requiredObject(raw, "mode", "candidates")
		return ok && requiredCandidates(body["candidates"])
	}
	return false
}

func controlError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrChanged) {
		fail(w, 409, "CONFLICT", err.Error())
		return
	}
	if errors.Is(err, ErrState) {
		fail(w, 409, "CONFLICT", err.Error())
		return
	}
	fail(w, 400, "VALIDATION_ERROR", err.Error())
}

// ServeHTTP intentionally exposes no /paso. Each execution's private loopback
// application owns that authenticated contract and its ephemeral movement key.
func (m *Manager) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id, err := randomID()
	if err != nil {
		fail(w, 500, "INTERNAL_ERROR", "No pudo procesarse la solicitud.")
		return
	}
	w.Header().Set("x-request-id", id)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if !loopbackHost(r.Host) {
		fail(w, 403, "UNAUTHORIZED", "El laboratorio sólo admite acceso local.")
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		w.Header().Add("Vary", "Origin")
		if !m.allowedOrigin(origin) {
			fail(w, 403, "UNAUTHORIZED", "Origen no autorizado para el laboratorio.")
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Expose-Headers", "x-request-id")
	}
	if r.Method == http.MethodOptions {
		if !m.allowedOrigin(r.Header.Get("Origin")) {
			fail(w, 403, "UNAUTHORIZED", "Origen no autorizado.")
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Idempotency-Key")
		w.WriteHeader(204)
		return
	}
	method := "GET"
	incidentMethod, publicIncident, isIncident := incidentRoute(r.URL.Path)
	if isIncident {
		method = incidentMethod
		if r.URL.Path == "/v1/incidents" && r.Method == http.MethodPost {
			method = "POST"
		}
	} else {
		switch r.URL.Path {
		case "/healthz", "/lab/catalog", "/lab/graph", "/lab/state", "/lab/session", "/v1/reference/status", "/v1/reference/susceptibility", "/v1/reference/rain-events", "/lab/telemetry":
		case "/lab/runs", "/lab/actions", "/lab/candidates/validate", "/lab/comparisons", "/lab/reference/refresh":
			method = "POST"
		default:
			fail(w, 404, "NOT_FOUND", "El recurso solicitado no existe.")
			return
		}
	}
	if r.Method != method {
		w.Header().Set("Allow", method)
		fail(w, 405, "METHOD_NOT_ALLOWED", "Método no permitido.")
		return
	}
	if method == "POST" && !(isIncident && publicIncident) && !m.authorized(r) {
		fail(w, 401, "UNAUTHORIZED", "Se requiere una sesión local y token CSRF válidos.")
		return
	}
	if isIncident {
		m.serveIncident(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/v1/reference/") || r.URL.Path == "/lab/reference/refresh" || r.URL.Path == "/lab/telemetry" {
		m.serveReference(w, r)
		return
	}
	switch r.URL.Path {
	case "/healthz":
		writeJSON(w, 200, map[string]string{"status": "ok", "service": "corodev-flood-lab", "version": "0.1.0"})
	case "/lab/session":
		state, err := m.session(w, r)
		if err != nil {
			fail(w, 500, "INTERNAL_ERROR", "No pudo crearse la sesión local.")
			return
		}
		writeJSON(w, 200, state)
	case "/lab/catalog":
		writeJSON(w, 200, m.Catalog())
	case "/lab/state":
		writeJSON(w, 200, m.State())
	case "/lab/graph":
		g, err := m.Graph(r.URL.Query().Get("mode"), r.URL.Query().Get("run_id"))
		if err != nil {
			controlError(w, err)
			return
		}
		writeJSON(w, 200, g)
	case "/lab/candidates/validate":
		var input CandidateRequest
		if !decode(w, r, &input) {
			return
		}
		result, err := m.Validate(input)
		if err != nil {
			controlError(w, err)
			return
		}
		writeJSON(w, 200, result)
	case "/lab/actions":
		var input Action
		if !decode(w, r, &input) {
			return
		}
		result, err := m.Act(input)
		if err != nil {
			controlError(w, err)
			return
		}
		writeJSON(w, 200, result)
	case "/lab/runs", "/lab/comparisons":
		var input RunRequest
		if !decode(w, r, &input) {
			return
		}
		var result State
		var err error
		if r.URL.Path == "/lab/runs" {
			result, err = m.Start(input)
		} else {
			result, err = m.Compare(input)
		}
		if err != nil {
			controlError(w, err)
			return
		}
		writeJSON(w, 200, result)
	}
}
