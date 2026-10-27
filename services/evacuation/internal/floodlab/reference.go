package floodlab

import (
	"corodev/evacuation/internal/flood"
	"corodev/evacuation/internal/reference"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
	"fmt"
	"net/http"
)

func (m *Manager) SetReferenceService(s *reference.Service) error {
	m.opMu.Lock()
	defer m.opMu.Unlock()
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.referenceService != nil {
		return ErrState
	}
	m.referenceService = s
	return nil
}
func (m *Manager) reference() *reference.Service {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.referenceService
}
func validReference(r *GeographicReference) bool {
	return r == nil || finite(r.Strength) && r.Strength >= 0 && r.Strength <= 1 && (!r.Enabled || r.DatasetVersion != "")
}
func (m *Manager) configureReference(cfg RunConfig, fc *flood.Config, g *world.Graph) error {
	if !validReference(cfg.GeographicReference) {
		return ErrInvalid
	}
	r := cfg.GeographicReference
	if r == nil || !r.Enabled {
		return nil
	}
	service := m.reference()
	if service == nil {
		return fmt.Errorf("No hay una copia oficial validada; desactiva la referencia para usar la simulación sintética.")
	}
	c, err := service.Collection(r.DatasetVersion)
	if err != nil {
		return err
	}
	return reference.Configure(c, fc, g, cfg.Seed, r.Strength)
}

type Telemetry struct {
	RunID string `json:"run_id"`
	simulation.OperationalStats
	Reference reference.Metrics `json:"reference"`
}

func (m *Manager) Telemetry() Telemetry {
	m.opMu.Lock()
	defer m.opMu.Unlock()
	m.mu.RLock()
	current, id, s := m.current, m.state.RunID, m.referenceService
	m.mu.RUnlock()
	out := Telemetry{RunID: id, OperationalStats: current.app.Simulator.OperationalStats()}
	if s != nil {
		out.Reference = s.Status().Metrics
	}
	return out
}
func (m *Manager) serveReference(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/lab/telemetry" {
		writeJSON(w, 200, m.Telemetry())
		return
	}
	service := m.reference()
	if service == nil {
		if r.URL.Path == "/v1/reference/status" {
			writeJSON(w, 200, reference.Status{SchemaVersion: 1, Mode: "disabled", Availability: "disabled", ProviderStatus: "offline", Message: "Referencia oficial deshabilitada; el motor sintético sigue operativo."})
			return
		}
		fail(w, 503, "UNAVAILABLE", "La referencia oficial no está habilitada.")
		return
	}
	switch r.URL.Path {
	case "/v1/reference/status":
		writeJSON(w, 200, service.Status())
	case "/lab/reference/refresh":
		if !service.Refresh(m.ctx) {
			fail(w, 409, "CONFLICT", "La actualización externa está deshabilitada en modo offline.")
			return
		}
		writeJSON(w, 202, service.Status())
	case "/v1/reference/rain-events":
		events, err := service.Events()
		if err != nil {
			fail(w, 503, "UNAVAILABLE", err.Error())
			return
		}
		writeJSON(w, 200, events)
	case "/v1/reference/susceptibility":
		for key, values := range r.URL.Query() {
			if (key != "bbox" && key != "version") || len(values) != 1 || values[0] == "" {
				fail(w, 400, "VALIDATION_ERROR", "Consulta geográfica inválida.")
				return
			}
		}
		b, err := reference.ParseBBox(r.URL.Query().Get("bbox"))
		if err != nil {
			fail(w, 400, "VALIDATION_ERROR", err.Error())
			return
		}
		collection, err := service.Collection(r.URL.Query().Get("version"))
		if err != nil {
			fail(w, 503, "UNAVAILABLE", err.Error())
			return
		}
		tag := `"` + collection.Provenance.DatasetVersion + ":" + fmt.Sprint(b) + `"`
		w.Header().Set("ETag", tag)
		if r.Header.Get("If-None-Match") == tag {
			w.WriteHeader(304)
			return
		}
		writeJSON(w, 200, reference.Filter(collection, b))
	}
}
