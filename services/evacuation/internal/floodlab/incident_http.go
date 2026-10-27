package floodlab

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"corodev/evacuation/internal/incidents"
)

// The public exception is an exact endpoint allowlist. All other POSTs retain
// the existing local cookie, explicit Origin and session-bound CSRF checks.
func incidentRoute(path string) (method string, public bool, ok bool) {
	switch path {
	case "/lab/incidents/permissions":
		return "GET", true, true
	case "/v1/incidents", "/v1/incidents/config":
		return "GET", true, true
	case "/v1/incidents/resolve":
		return "POST", true, true
	case "/lab/incidents/synthetic":
		return "POST", false, true
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(parts) == 3 && parts[0] == "v1" && parts[1] == "incidents" && incidents.ValidID(parts[2]) {
		return "GET", true, true
	}
	if len(parts) == 4 && parts[0] == "lab" && parts[1] == "incidents" && incidents.ValidID(parts[2]) && (parts[3] == "status" || parts[3] == "apply") {
		return "POST", false, true
	}
	return "", false, false
}

func decodeIncident(w http.ResponseWriter, r *http.Request, destination any, required ...string) bool {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		fail(w, 400, "VALIDATION_ERROR", "Se requiere un cuerpo JSON válido.")
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	var raw json.RawMessage
	if d.Decode(&raw) != nil || d.Decode(new(any)) != io.EOF {
		fail(w, 400, "VALIDATION_ERROR", "El reporte debe ser un único objeto JSON de hasta 8 KiB.")
		return false
	}
	object, ok := requiredObject(raw, required...)
	if !ok {
		fail(w, 400, "VALIDATION_ERROR", "Revisa los campos obligatorios del reporte.")
		return false
	}
	if value, present := object["edge_id_hint"]; present {
		var hint string
		if json.Unmarshal(value, &hint) != nil || len(hint) < 1 || len(hint) > 120 {
			fail(w, 400, "VALIDATION_ERROR", "La referencia de calle debe ser válida.")
			return false
		}
	}
	if value, present := object["evidence_metadata"]; present {
		if _, ok := requiredObject(value, "attachment_count", "storage_status"); !ok {
			fail(w, 400, "VALIDATION_ERROR", "Revisa los metadatos de evidencia; esta fase no admite adjuntos.")
			return false
		}
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	if strict.Decode(destination) != nil {
		fail(w, 400, "VALIDATION_ERROR", "Revisa los campos y formatos enviados.")
		return false
	}
	return true
}

func incidentError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, incidents.ErrUnavailable):
		fail(w, 503, "UNAVAILABLE", incidents.ErrUnavailable.Error())
	case errors.Is(err, incidents.ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "UNAVAILABLE", incidents.ErrRateLimited.Error())
	case errors.Is(err, incidents.ErrNotFound):
		fail(w, 404, "NOT_FOUND", incidents.ErrNotFound.Error())
	case errors.Is(err, incidents.ErrConflict), errors.Is(err, incidents.ErrIneligible):
		fail(w, 409, "CONFLICT", err.Error())
	case errors.Is(err, ErrChanged), errors.Is(err, ErrState):
		controlError(w, err)
	default:
		fail(w, 400, "VALIDATION_ERROR", incidents.ErrInvalid.Error())
	}
}
func incidentQuery(r *http.Request) (incidents.Query, error) {
	q := r.URL.Query()
	query := incidents.Query{IncidentType: q.Get("incident_type"), VerificationStatus: q.Get("verification_status"), MapVisibility: q.Get("map_visibility"), Limit: 100}
	for key, values := range q {
		if len(values) != 1 || values[0] == "" || !contains([]string{"bbox", "incident_type", "verification_status", "map_visibility", "since", "until", "received_after", "limit", "offset"}, key) {
			return query, incidents.ErrInvalid
		}
	}
	if value := q.Get("bbox"); value != "" {
		parts := strings.Split(value, ",")
		if len(parts) != 4 {
			return query, incidents.ErrInvalid
		}
		v := [4]float64{}
		for i, p := range parts {
			n, err := strconv.ParseFloat(p, 64)
			if err != nil {
				return query, incidents.ErrInvalid
			}
			v[i] = n
		}
		query.BBox = &incidents.Bounds{MinLatitude: v[1], MinLongitude: v[0], MaxLatitude: v[3], MaxLongitude: v[2]}
	}
	for _, item := range []struct {
		key string
		out *time.Time
	}{{"since", &query.Since}, {"until", &query.Until}, {"received_after", &query.ReceivedAfter}} {
		if v := q.Get(item.key); v != "" {
			parsed, err := time.Parse(time.RFC3339Nano, v)
			if err != nil {
				return query, incidents.ErrInvalid
			}
			*item.out = parsed
		}
	}
	for _, item := range []struct {
		key string
		out *int
	}{{"limit", &query.Limit}, {"offset", &query.Offset}} {
		if v := q.Get(item.key); v != "" {
			parsed, err := strconv.Atoi(v)
			if err != nil {
				return query, incidents.ErrInvalid
			}
			*item.out = parsed
		}
	}
	return query, nil
}
func contains(values []string, value string) bool {
	for _, v := range values {
		if value == v {
			return true
		}
	}
	return false
}

func (m *Manager) serveIncident(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/lab/incidents/permissions" {
		writeJSON(w, 200, m.incidentModerationPermissions(r))
		return
	}
	store := m.incidents()
	if store == nil {
		incidentError(w, incidents.ErrUnavailable)
		return
	}
	switch r.URL.Path {
	case "/v1/incidents/config":
		writeJSON(w, 200, store.Info())
		return
	case "/v1/incidents/resolve":
		var input incidents.Location
		if !decodeIncident(w, r, &input, "latitude", "longitude") {
			return
		}
		result, err := store.Resolve(input)
		if err != nil {
			incidentError(w, err)
			return
		}
		writeJSON(w, 200, result)
		return
	case "/v1/incidents", "/lab/incidents/synthetic":
		if r.Method == "GET" {
			query, err := incidentQuery(r)
			if err != nil {
				incidentError(w, err)
				return
			}
			result, err := store.List(query)
			if err != nil {
				incidentError(w, err)
				return
			}
			writeJSON(w, 200, result)
			return
		}
		var input incidents.Create
		if !decodeIncident(w, r, &input, "incident_type", "latitude", "longitude", "description", "severity_reported", "road_passability_reported", "event_time", "location_method") {
			return
		}
		source := "citizen"
		if r.URL.Path == "/lab/incidents/synthetic" {
			source = "synthetic"
		}
		client, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			client = r.RemoteAddr
		}
		result, created, err := store.Create(input, r.Header.Get("Idempotency-Key"), source, client)
		if err != nil {
			incidentError(w, err)
			return
		}
		status := 200
		if created {
			status = 201
		}
		writeJSON(w, status, result)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")
	id := parts[2]
	if len(parts) == 3 {
		result, err := store.Get(id)
		if err != nil {
			incidentError(w, err)
			return
		}
		writeJSON(w, 200, result)
		return
	}
	if parts[3] == "status" {
		// A loopback development cookie is not an operator account. Reuse the
		// configured identity bridge instead of granting visitors moderation.
		permissions := m.incidentModerationPermissions(r)
		if !permissions.CanReview {
			fail(w, 403, "UNAUTHORIZED", "Se requiere una cuenta de operador autorizada para moderar reportes.")
			return
		}
		var input incidents.StatusUpdate
		if !decodeIncident(w, r, &input, "verification_status", "expected_updated_at") {
			return
		}
		if input.OfficialSource != nil && !permissions.CanMarkOfficial || input.MapWithdrawn != nil && !permissions.CanWithdraw {
			fail(w, 403, "UNAUTHORIZED", "La sesión no tiene permiso para esta acción de moderación.")
			return
		}
		input.Reviewer = "operator-session:" + sessionKey(r.Header.Get("X-CSRF-Token"))[:24]
		result, err := m.ReviewIncident(id, input)
		if err != nil {
			incidentError(w, err)
			return
		}
		writeJSON(w, 200, result)
		return
	}
	var input incidents.ApplyRequest
	if !decodeIncident(w, r, &input, "expected_run_id", "duration_steps", "effect", "experimental_ack") {
		return
	}
	result, err := m.ApplyIncident(r.Context(), id, input)
	if err != nil {
		incidentError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
