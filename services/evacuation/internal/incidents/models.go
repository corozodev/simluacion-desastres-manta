// Package incidents stores declared observations, separate from authoritative
// simulation state. A citizen observation is never an official road condition.
package incidents

import "time"

const (
	MaxDescriptionLength = 500
	MaxSnapDistanceM     = 50.0
	Notice               = "Reporte ciudadano pendiente de verificación. La ubicación y la novedad son declaradas; no constituyen una alerta oficial ni una ruta segura."
)

type Bounds struct {
	MinLatitude  float64 `json:"min_latitude"`
	MinLongitude float64 `json:"min_longitude"`
	MaxLatitude  float64 `json:"max_latitude"`
	MaxLongitude float64 `json:"max_longitude"`
}
type EvidenceMetadata struct {
	AttachmentCount int    `json:"attachment_count"`
	StorageStatus   string `json:"storage_status"`
}
type ServiceInfo struct {
	Enabled              bool    `json:"enabled"`
	SchemaVersion        int     `json:"schema_version"`
	Bounds               Bounds  `json:"bounds"`
	MaxDescriptionLength int     `json:"max_description_length"`
	MaxSnapDistanceM     float64 `json:"max_snap_distance_m"`
	VerificationNotice   string  `json:"verification_notice"`
	PhotoUploadsEnabled  bool    `json:"photo_uploads_enabled"`
}
type Location struct {
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
	EdgeIDHint string  `json:"edge_id_hint,omitempty"`
}
type EdgeMatch struct {
	EdgeID     string  `json:"edge_id"`
	RoadType   string  `json:"road_type"`
	DistanceM  float64 `json:"distance_m"`
	FromNodeID string  `json:"from_node_id"`
	ToNodeID   string  `json:"to_node_id"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
}
type Resolution struct {
	Matched          bool        `json:"matched"`
	Ambiguous        bool        `json:"ambiguous"`
	Candidates       []EdgeMatch `json:"candidates"`
	Message          string      `json:"message"`
	GraphVersion     string      `json:"graph_version"`
	MaxSnapDistanceM float64     `json:"max_snap_distance_m"`
}
type Create struct {
	IncidentType            string            `json:"incident_type"`
	Latitude                float64           `json:"latitude"`
	Longitude               float64           `json:"longitude"`
	Description             string            `json:"description"`
	SeverityReported        string            `json:"severity_reported"`
	RoadPassabilityReported string            `json:"road_passability_reported"`
	EventTime               time.Time         `json:"event_time"`
	LocationMethod          string            `json:"location_method"`
	EdgeIDHint              string            `json:"edge_id_hint,omitempty"`
	EvidenceMetadata        *EvidenceMetadata `json:"evidence_metadata,omitempty"`
}
type Incident struct {
	MapWithdrawn            bool             `json:"map_withdrawn,omitempty"`
	ModerationNote          string           `json:"moderation_note,omitempty"`
	OfficialSource          *OfficialSource  `json:"official_source,omitempty"`
	SchemaVersion           int              `json:"schema_version"`
	IncidentID              string           `json:"incident_id"`
	IncidentType            string           `json:"incident_type"`
	Latitude                float64          `json:"latitude"`
	Longitude               float64          `json:"longitude"`
	Description             string           `json:"description"`
	SeverityReported        string           `json:"severity_reported"`
	RoadPassabilityReported string           `json:"road_passability_reported"`
	EventTime               time.Time        `json:"event_time"`
	ReceivedAt              time.Time        `json:"received_at"`
	SourceType              string           `json:"source_type"`
	VerificationStatus      string           `json:"verification_status"`
	EvidenceMetadata        EvidenceMetadata `json:"evidence_metadata"`
	AffectedEdgeIDs         []string         `json:"affected_edge_ids"`
	GraphVersion            string           `json:"graph_version"`
	SnapDistanceM           float64          `json:"snap_distance_m"`
	LocationMethod          string           `json:"location_method"`
	LocationPrecisionM      float64          `json:"location_precision_m"`
	ExpiresAt               time.Time        `json:"expires_at"`
	UpdatedAt               time.Time        `json:"updated_at"`
}
type List struct {
	Incidents []Incident `json:"incidents"`
	Total     int        `json:"total"`
	Limit     int        `json:"limit"`
	Offset    int        `json:"offset"`
	HasMore   bool       `json:"has_more"`
}
type Query struct {
	BBox                             *Bounds
	IncidentType, VerificationStatus string
	MapVisibility                    string
	Since, Until, ReceivedAfter      time.Time
	Limit, Offset                    int
}
type StatusUpdate struct {
	VerificationStatus string    `json:"verification_status"`
	ExpectedUpdatedAt  time.Time `json:"expected_updated_at"`
	Note               string    `json:"note,omitempty"`
	MapWithdrawn       *bool     `json:"map_withdrawn,omitempty"`
	OfficialSource     *OfficialSourceInput `json:"official_source,omitempty"`
	OfficialAck        bool      `json:"official_ack,omitempty"`
	Reviewer           string    `json:"-"`
}
type OfficialSourceInput struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}
type OfficialSource struct {
	Title      string    `json:"title"`
	URL        string    `json:"url"`
	RecordedAt time.Time `json:"recorded_at"`
}
type ApplyRequest struct {
	ExpectedRunID   string `json:"expected_run_id"`
	DurationSteps   int    `json:"duration_steps"`
	Effect          string `json:"effect"`
	ExperimentalAck bool   `json:"experimental_ack"`
}
type Application struct {
	ApplicationID                   string    `json:"application_id"`
	IncidentID                      string    `json:"incident_id"`
	RunID                           string    `json:"run_id"`
	AffectedEdgeIDs                 []string  `json:"affected_edge_ids"`
	SimulationStep                  int       `json:"simulation_step"`
	WorldVersion                    uint64    `json:"world_version"`
	SourceType                      string    `json:"source_type"`
	VerificationStatusAtApplication string    `json:"verification_status_at_application"`
	Effect                          string    `json:"effect"`
	ExpiresAtSimulationStep         int       `json:"expires_at_simulation_step"`
	AppliedAt                       time.Time `json:"applied_at"`
}

func (i Incident) clone() Incident {
	i.AffectedEdgeIDs = append([]string{}, i.AffectedEdgeIDs...)
	if i.OfficialSource != nil {
		source := *i.OfficialSource
		i.OfficialSource = &source
	}
	return i
}
func (a Application) Clone() Application {
	a.AffectedEdgeIDs = append([]string{}, a.AffectedEdgeIDs...)
	return a
}
