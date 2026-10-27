// Package reference reads bounded official reference data. It never observes or
// changes simulation state and never turns historical events into road closures.
package reference

import (
	"encoding/json"
	"fmt"
	"time"
)

const SusceptibilityURL = "https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Susceptibilidad_de_Inundaciones/MapServer/0"
const EventsURL = "https://sgrportal.gestionderiesgos.gob.ec/server/rest/services/Hosted/EVENTOS_X_LLUVIAS/FeatureServer/0"
const GeneralizationDegrees = .0001 // about 11 m here, display/reference, never survey accuracy
var Manta = [4]float64{-80.8188739, -1.017171, -80.6581593, -.9297437}

type Provenance struct {
	Category           string     `json:"category"`
	Source             string     `json:"source"`
	URL                string     `json:"url"`
	ConsultedAt        time.Time  `json:"consulted_at"`
	PublicationDate    string     `json:"publication_date,omitempty"`
	DeclaredUpdatedAt  *time.Time `json:"declared_updated_at,omitempty"`
	DeclaredUpdateDate string     `json:"declared_update_date,omitempty"`
	PortalModifiedAt   *time.Time `json:"portal_modified_at,omitempty"`
	Attribution        string     `json:"attribution"`
	License            string     `json:"license"`
	OriginalCRS        string     `json:"original_crs"`
	OutputCRS          string     `json:"output_crs"`
	DatasetVersion     string     `json:"dataset_version"`
	TemporalScope      string     `json:"temporal_scope"`
	SourceYears        []int      `json:"source_years"`
}
type Position [2]float64 // GeoJSON longitude, latitude, never UTM eastings/northings.
func (p *Position) UnmarshalJSON(raw []byte) error {
	var pair []json.RawMessage
	if json.Unmarshal(raw, &pair) != nil || len(pair) != 2 {
		return fmt.Errorf("se requiere un par GeoJSON")
	}
	for i, v := range pair {
		if string(v) == "null" || json.Unmarshal(v, &p[i]) != nil || !finite(p[i]) {
			return fmt.Errorf("coordenada inválida")
		}
	}
	return nil
}

type Geometry struct {
	Type        string         `json:"type"`
	Coordinates [][][]Position `json:"coordinates"`
}
type Properties struct {
	ObjectID       string `json:"object_id"`
	Susceptibility string `json:"susceptibility"`
	SourceYear     int    `json:"source_year,omitempty"`
}
type Feature struct {
	Type       string     `json:"type"`
	ID         string     `json:"id"`
	Properties Properties `json:"properties"`
	Geometry   Geometry   `json:"geometry"`
}
type Collection struct {
	SchemaVersion         int        `json:"schema_version"`
	Type                  string     `json:"type"`
	BBox                  [4]float64 `json:"bbox"`
	Features              []Feature  `json:"features"`
	Provenance            Provenance `json:"provenance"`
	FeatureCount          int        `json:"feature_count"`
	VertexCount           int        `json:"vertex_count"`
	GeneralizationDegrees float64    `json:"generalization_degrees"`
}
type RainEvent struct {
	ObjectID           string  `json:"object_id"`
	Event              string  `json:"event"`
	Canton             string  `json:"canton"`
	EventDate          string  `json:"event_date"`
	ClosedDate         string  `json:"closed_date"`
	DeclaredUpdateDate string  `json:"declared_update_date,omitempty"`
	Latitude           float64 `json:"latitude"`
	Longitude          float64 `json:"longitude"`
}
type RainEvents struct {
	SchemaVersion int         `json:"schema_version"`
	Events        []RainEvent `json:"events"`
	Provenance    Provenance  `json:"provenance"`
}
type Bundle struct {
	SchemaVersion  int         `json:"schema_version"`
	Susceptibility Collection  `json:"susceptibility"`
	RainEvents     RainEvents  `json:"rain_events"`
	Acquisition    Acquisition `json:"acquisition"`
}
type Acquisition struct {
	Strategy                 string   `json:"strategy"`
	SusceptibilityPagination bool     `json:"susceptibility_pagination"`
	EventsPagination         bool     `json:"events_pagination"`
	MaxRecordCount           int      `json:"max_record_count"`
	Queries                  []string `json:"queries"`
}
type Envelope struct {
	SHA256 string `json:"sha256"`
	Bundle Bundle `json:"bundle"`
}
type Metrics struct {
	Queries        uint64  `json:"queries"`
	ProviderErrors uint64  `json:"provider_errors"`
	CacheHits      uint64  `json:"cache_hits"`
	CacheMisses    uint64  `json:"cache_misses"`
	LastQueryMS    float64 `json:"last_query_ms"`
	TotalQueryMS   float64 `json:"total_query_ms"`
	ResponseBytes  uint64  `json:"response_bytes"`
	LastRefreshMS  float64 `json:"last_refresh_ms"`
}
type Status struct {
	SchemaVersion       int         `json:"schema_version"`
	Mode                string      `json:"mode"`
	Availability        string      `json:"availability"`
	Refreshing          bool        `json:"refreshing"`
	ProviderStatus      string      `json:"provider_status"`
	Message             string      `json:"message"`
	DatasetVersion      string      `json:"dataset_version,omitempty"`
	EventDatasetVersion string      `json:"event_dataset_version,omitempty"`
	Provenance          *Provenance `json:"provenance,omitempty"`
	FeatureCount        int         `json:"feature_count"`
	VertexCount         int         `json:"vertex_count"`
	LastRefreshError    string      `json:"last_refresh_error,omitempty"`
	Metrics             Metrics     `json:"metrics"`
}

func clone[T any](value T) T {
	raw, _ := json.Marshal(value)
	var copy T
	_ = json.Unmarshal(raw, &copy)
	return copy
}
