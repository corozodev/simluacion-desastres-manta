package reference

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

func Validate(b Bundle) error {
	c := b.Susceptibility
	if b.SchemaVersion != 1 || c.SchemaVersion != 1 || c.Type != "FeatureCollection" || c.BBox != Manta || len(c.Features) == 0 || len(c.Features) > 500 || c.FeatureCount != len(c.Features) || c.GeneralizationDegrees != GeneralizationDegrees || c.Provenance.Category != "official_reference" || c.Provenance.URL != SusceptibilityURL || c.Provenance.OriginalCRS != "EPSG:32717" || c.Provenance.OutputCRS != "EPSG:4326" || c.Provenance.ConsultedAt.IsZero() || c.Provenance.ConsultedAt.After(time.Now().Add(5*time.Minute)) || c.Provenance.Attribution == "" || c.Provenance.License == "" || c.Provenance.DatasetVersion != "sngr-susceptibility-"+version(c.Features) {
		return fmt.Errorf("referencia inválida")
	}
	count := 0
	seen := map[string]bool{}
	for _, f := range c.Features {
		if f.Type != "Feature" || f.ID == "" || f.Properties.ObjectID != f.ID || seen[f.ID] || (f.Properties.Susceptibility != "ALTA" && f.Properties.Susceptibility != "MEDIA" && f.Properties.Susceptibility != "BAJA") {
			return fmt.Errorf("clase o ID inválido")
		}
		seen[f.ID] = true
		n, err := ValidateGeometry(f.Geometry)
		if err != nil {
			return err
		}
		count += n
	}
	if count != c.VertexCount || count > 120000 {
		return fmt.Errorf("cuota de geometría excedida")
	}
	e := b.RainEvents
	if e.SchemaVersion != 1 || len(e.Events) > 500 || e.Provenance.Category != "official_observation" || e.Provenance.URL != EventsURL || e.Provenance.OutputCRS != "EPSG:4326" || e.Provenance.OriginalCRS != "EPSG:4326" || e.Provenance.ConsultedAt.IsZero() || e.Provenance.Attribution == "" || e.Provenance.DatasetVersion != "sngr-rain-events-"+version(e.Events) {
		return fmt.Errorf("eventos inválidos")
	}
	seen = map[string]bool{}
	for _, v := range e.Events {
		if v.ObjectID == "" || seen[v.ObjectID] || !finite(v.Latitude) || !finite(v.Longitude) || v.Latitude < Manta[1] || v.Latitude > Manta[3] || v.Longitude < Manta[0] || v.Longitude > Manta[2] {
			return fmt.Errorf("evento fuera de consulta")
		}
		if _, err := time.Parse("2006-01-02", v.EventDate); err != nil {
			return err
		}
		seen[v.ObjectID] = true
	}
	return nil
}
func Read(path string) (Bundle, error) {
	f, e := os.Open(path)
	if e != nil {
		return Bundle{}, e
	}
	defer f.Close()
	d := json.NewDecoder(io.LimitReader(f, 8*1024*1024+1))
	d.DisallowUnknownFields()
	var envelope Envelope
	if e = d.Decode(&envelope); e != nil {
		return Bundle{}, e
	}
	if d.Decode(new(any)) != io.EOF || envelope.SHA256 != version(envelope.Bundle) {
		return Bundle{}, fmt.Errorf("checksum o envelope inválido")
	}
	if e = Validate(envelope.Bundle); e != nil {
		return Bundle{}, e
	}
	return envelope.Bundle, nil
}
func Write(path string, b Bundle) error {
	if err := Validate(b); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".reference-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = json.NewEncoder(f).Encode(Envelope{SHA256: version(b), Bundle: b}); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

// Service never performs external I/O in a read or simulation operation.
// Refresh builds/validates a separate immutable bundle, then swaps under a mutex.
type Service struct {
	mu             sync.RWMutex
	client         *Client
	bundle         *Bundle
	history        map[string]Collection
	cache          string
	online         bool
	refreshing     bool
	lastError      string
	providerStatus string
	hits, misses   uint64
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	closed         bool
}

func New(cache, bundled string, online bool, clients ...*Client) *Service {
	s := &Service{client: NewClient(), cache: cache, online: online, providerStatus: "offline", history: map[string]Collection{}}
	if len(clients) > 0 && clients[0] != nil {
		s.client = clients[0]
	}
	if online {
		s.providerStatus = "unknown"
	}
	for _, path := range []string{bundled, cache} {
		if path == "" {
			continue
		}
		b, err := Read(path)
		if err != nil {
			if !os.IsNotExist(err) {
				s.lastError = "Se descartó una copia local inválida o corrupta."
			}
			continue
		}
		if s.bundle == nil || b.Susceptibility.Provenance.ConsultedAt.After(s.bundle.Susceptibility.Provenance.ConsultedAt) {
			copy := b
			s.bundle = &copy
			s.history[b.Susceptibility.Provenance.DatasetVersion] = b.Susceptibility
		}
	}
	return s
}
func (s *Service) Status() Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	mode := "offline"
	if s.online {
		mode = "online"
	}
	out := Status{SchemaVersion: 1, Mode: mode, Availability: "unavailable", Refreshing: s.refreshing, ProviderStatus: s.providerStatus, Message: "Fuente no disponible: el motor totalmente sintético sigue operativo.", LastRefreshError: s.lastError, Metrics: s.client.Metrics()}
	out.Metrics.CacheHits = s.hits
	out.Metrics.CacheMisses = s.misses
	if s.bundle != nil {
		c := s.bundle.Susceptibility
		p := clone(c.Provenance)
		out.Provenance = &p
		out.DatasetVersion = p.DatasetVersion
		out.EventDatasetVersion = s.bundle.RainEvents.Provenance.DatasetVersion
		out.FeatureCount = c.FeatureCount
		out.VertexCount = c.VertexCount
		out.Availability = "cached"
		if time.Since(p.ConsultedAt) > 6*time.Hour {
			out.Availability = "stale"
		}
		out.Message = "Copia oficial consultada el " + p.ConsultedAt.Format(time.RFC3339) + ". Susceptibilidad estructural; no inundación actual."
	}
	return out
}
func (s *Service) Collection(expected string) (Collection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if expected != "" {
		if c, ok := s.history[expected]; ok {
			s.hits++
			return clone(c), nil
		}
	} else if s.bundle != nil {
		s.hits++
		return clone(s.bundle.Susceptibility), nil
	}
	s.misses++
	return Collection{}, fmt.Errorf("No existe una copia local válida de la versión solicitada.")
}
func (s *Service) Events() (RainEvents, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.bundle == nil {
		s.misses++
		return RainEvents{}, fmt.Errorf("Copia de eventos no disponible.")
	}
	s.hits++
	return clone(s.bundle.RainEvents), nil
}
func (s *Service) Refresh(ctx context.Context) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.online || s.closed {
		return false
	}
	if s.refreshing {
		return true
	}
	s.refreshing = true
	job, cancel := context.WithTimeout(ctx, 60*time.Second)
	s.cancel = cancel
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer cancel()
		b, err := s.client.Fetch(job)
		failureMessage := ErrProvider.Error()
		providerStatus := "error"
		if err == nil {
			providerStatus = "ok"
		}
		if err == nil && s.cache != "" {
			err = Write(s.cache, b)
			if err != nil {
				failureMessage = "No se pudo guardar la nueva copia oficial. Se conserva la copia anterior en memoria y disco."
			}
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		s.refreshing = false
		if err != nil {
			s.providerStatus = providerStatus
			s.lastError = failureMessage
			return
		}
		s.providerStatus = "ok"
		s.lastError = ""
		s.bundle = &b
		s.history[b.Susceptibility.Provenance.DatasetVersion] = b.Susceptibility
		if len(s.history) > 3 {
			for key := range s.history {
				if key != b.Susceptibility.Provenance.DatasetVersion {
					delete(s.history, key)
					break
				}
			}
		}
	}()
	return true
}
func (s *Service) Close() {
	s.mu.Lock()
	s.closed = true
	if s.cancel != nil {
		s.cancel()
	}
	s.mu.Unlock()
	s.wg.Wait()
}
