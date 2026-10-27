package control

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
)

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message, "requestId": w.Header().Get("x-request-id"), "details": []any{}}})
}
func decode(w http.ResponseWriter, r *http.Request, destination any) bool {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		writeError(w, 400, "VALIDATION_ERROR", "Se requiere JSON.")
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	d.DisallowUnknownFields()
	if d.Decode(destination) != nil || d.Decode(new(any)) != io.EOF {
		writeError(w, 400, "VALIDATION_ERROR", "Revisa los datos enviados.")
		return false
	}
	return true
}
func (m *Manager) allowedOrigin(r *http.Request) bool {
	for _, origin := range m.options.Origins {
		if strings.TrimSpace(origin) == r.Header.Get("Origin") && origin != "" {
			return true
		}
	}
	return false
}
func (m *Manager) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id, err := randomID()
	if err != nil {
		writeError(w, 500, "INTERNAL_ERROR", "No se pudo procesar la solicitud.")
		return
	}
	w.Header().Set("x-request-id", id)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	defer func() {
		if recover() != nil {
			m.options.Logger.Error("control request failed", "request_id", id)
			writeError(w, 500, "INTERNAL_ERROR", "No se pudo procesar la solicitud.")
		}
	}()
	admin := strings.HasPrefix(r.URL.Path, "/admin/")
	if r.Header.Get("Origin") != "" {
		w.Header().Add("Vary", "Origin")
		if m.allowedOrigin(r) {
			w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
			w.Header().Set("Access-Control-Expose-Headers", "x-request-id")
			if admin {
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
		}
	}
	if admin && r.Method == http.MethodOptions {
		if !m.allowedOrigin(r) {
			writeError(w, 403, "UNAUTHORIZED", "Origen no autorizado.")
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token")
		w.WriteHeader(204)
		return
	}
	switch {
	case admin:
		m.adminHTTP(w, r)
	case r.URL.Path == "/simulation/catalog":
		if !readMethod(w, r) {
			return
		}
		writeJSON(w, 200, map[string]any{"default_mode": "competition", "presets": m.catalog.Presets(), "rounds": m.catalog.Rounds(), "admin_enabled": m.auth.enabled, "history_limit": HistoryLimit})
	case r.URL.Path == "/simulation":
		if !readMethod(w, r) {
			return
		}
		writeJSON(w, 200, m.Info())
	case strings.HasPrefix(r.URL.Path, "/runs/"):
		if !readMethod(w, r) {
			return
		}
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) != 3 || parts[0] != "runs" || len(parts[1]) != 32 || parts[2] != "estado" {
			writeError(w, 404, "NOT_FOUND", "Ronda no conservada.")
			return
		}
		snapshot, ok := m.saved(parts[1])
		if !ok {
			writeError(w, 404, "NOT_FOUND", "Ronda no conservada.")
			return
		}
		writeJSON(w, 200, snapshot)
	case r.URL.Path == "/grafo" && r.URL.Query().Get("mode") != "":
		if !readMethod(w, r) {
			return
		}
		if r.URL.Query().Get("run_id") != "" {
			writeError(w, 400, "VALIDATION_ERROR", "No combinar previsualización y ronda.")
			return
		}
		preset, ok := m.catalog.Preset(r.URL.Query().Get("mode"))
		if !ok || !preset.PreviewAvailable {
			writeError(w, 404, "NOT_FOUND", "Preset no disponible.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = m.catalog.WritePreview(preset.ID, w)
	default:
		m.activeHandler(w, r)
	}
}
func readMethod(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.WriteHeader(204)
		return false
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeError(w, 405, "METHOD_NOT_ALLOWED", "Método no permitido.")
		return false
	}
	return true
}

func (m *Manager) adminHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/admin/session" && r.Method == http.MethodGet {
		// A cross-origin request must never read CSRF material without an allowed
		// Origin. Same-origin/non-browser clients still require the session cookie.
		if r.Header.Get("Origin") != "" && !m.allowedOrigin(r) {
			writeError(w, 403, "UNAUTHORIZED", "Origen no autorizado.")
			return
		}
		state, _ := m.auth.read(r)
		writeJSON(w, 200, state)
		return
	}
	if !m.auth.enabled {
		writeError(w, 503, "ADMIN_DISABLED", "Administración no configurada en esta instancia.")
		return
	}
	if !m.allowedOrigin(r) {
		writeError(w, 403, "UNAUTHORIZED", "Origen no autorizado.")
		return
	}
	if r.URL.Path == "/admin/session" && r.Method == http.MethodPost {
		if !m.auth.attemptAllowed(time.Now()) {
			w.Header().Set("Retry-After", "60")
			writeError(w, 429, "RATE_LIMITED", "Demasiados intentos. Espera un minuto.")
			return
		}
		var input struct {
			Operator   string `json:"operator"`
			AccessCode string `json:"access_code"`
		}
		if !decode(w, r, &input) {
			return
		}
		if !m.auth.authenticate(input.Operator, input.AccessCode) {
			m.options.Logger.Warn("operator.login_rejected")
			writeError(w, 401, "UNAUTHORIZED", "Credenciales no válidas.")
			return
		}
		state, err := m.auth.create(w)
		if err != nil {
			writeError(w, 500, "INTERNAL_ERROR", "No se pudo crear la sesión.")
			return
		}
		m.options.Logger.Info("operator.session_created", "operator", state.Operator)
		writeJSON(w, 200, state)
		return
	}
	state, ok := m.auth.read(r)
	if !ok {
		writeError(w, 401, "UNAUTHORIZED", "Se requiere una sesión de operador.")
		return
	}
	if !validCSRF(r, state) {
		writeError(w, 403, "UNAUTHORIZED", "Token CSRF no válido.")
		return
	}
	if r.URL.Path == "/admin/session" && r.Method == http.MethodDelete {
		m.auth.revoke(w, r)
		m.options.Logger.Info("operator.session_revoked", "operator", state.Operator)
		writeJSON(w, 200, SessionState{Enabled: true, Authenticated: false})
		return
	}
	if r.URL.Path == "/admin/runs" && r.Method == http.MethodPost {
		var input struct {
			Mode          string `json:"mode"`
			Round         string `json:"round"`
			Seed          *int64 `json:"seed"`
			ExpectedRunID string `json:"expected_run_id"`
		}
		if !decode(w, r, &input) {
			return
		}
		if input.ExpectedRunID == "" || input.Seed == nil || input.Mode == "" || input.Round == "" {
			writeError(w, 400, "VALIDATION_ERROR", "Selecciona la ronda actual antes de iniciar otra.")
			return
		}
		info, err := m.Start(StartRequest{Mode: input.Mode, Round: input.Round, Seed: *input.Seed, ExpectedRunID: input.ExpectedRunID}, state.Operator)
		if err != nil {
			status, code, message := 503, "UNAVAILABLE", "No pudo prepararse la ronda; el estado anterior se conserva."
			switch {
			case errors.Is(err, ErrActive):
				status, code, message = 409, "RUN_ACTIVE", "Ya hay una ronda activa o un inicio en progreso."
			case errors.Is(err, ErrChanged):
				status, code, message = 409, "RUN_CHANGED", "La ronda seleccionada cambió."
			case errors.Is(err, ErrDisabled):
				status, code, message = 403, "MODE_DISABLED", "El preset experimental no está habilitado."
			case errors.Is(err, ErrInvalid):
				status, code, message = 400, "VALIDATION_ERROR", "Configuración no aprobada."
			}
			writeError(w, status, code, message)
			return
		}
		writeJSON(w, 201, info)
		return
	}
	writeError(w, 404, "NOT_FOUND", "Recurso no encontrado.")
}

// Prevent accidentally configuring the movement key as the admin verifier.
func (m *Manager) independentAdminKey() bool {
	return !m.auth.enabled || sha256.Sum256([]byte(m.options.APIKey)) != m.auth.hash
}
