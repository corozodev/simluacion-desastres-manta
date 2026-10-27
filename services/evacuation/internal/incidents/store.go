package incidents

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"

	"corodev/evacuation/internal/world"
)

var (
	ErrInvalid     = errors.New("revisa los datos y la calle asociada a la ubicación declarada")
	ErrNotFound    = errors.New("el incidente no existe")
	ErrConflict    = errors.New("la clave, versión o aplicación ya tiene otros datos; actualiza el estado")
	ErrRateLimited = errors.New("límite de recepción alcanzado; espera un minuto")
	ErrUnavailable = errors.New("el almacén persistente no está disponible")
	ErrIneligible  = errors.New("un reporte rechazado o vencido no puede aplicarse")
)

const maxRecords = 10000
const retention = 7 * 24 * time.Hour

var idPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var keyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,80}$`)

func ValidID(value string) bool { return idPattern.MatchString(value) }
func NewID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
func hash(value string) string { b := sha256.Sum256([]byte(value)); return hex.EncodeToString(b[:]) }
func validType(v string) bool {
	return oneOf(v, "flooded_road", "road_closed", "landslide", "fallen_tree", "bridge_damage", "other")
}
func validStatus(v string) bool {
	return oneOf(v, "pending", "corroborated", "verified", "rejected", "expired")
}
func oneOf(v string, values ...string) bool {
	for _, s := range values {
		if v == s {
			return true
		}
	}
	return false
}

type record struct {
	Incident     Incident `json:"incident"`
	RawLatitude  float64  `json:"raw_latitude"`
	RawLongitude float64  `json:"raw_longitude"`
	Moderation   []moderationEvent `json:"moderation,omitempty"`
}
// Private audit: never part of the public Incident DTO. Existing snapshots load
// without this optional field; no data migration or new store is required.
type moderationEvent struct {
	At             time.Time `json:"at"`
	Reviewer       string `json:"reviewer"`
	PreviousStatus string `json:"previous_status"`
	Status         string `json:"status"`
	Withdrawn      bool `json:"withdrawn"`
	Note           string `json:"note,omitempty"`
	OfficialSource *OfficialSource `json:"official_source,omitempty"`
}
type idempotency struct {
	BodyHash   string `json:"body_hash"`
	IncidentID string `json:"incident_id"`
}
type diskState struct {
	SchemaVersion int                    `json:"schema_version"`
	Records       map[string]record      `json:"records"`
	Idempotency   map[string]idempotency `json:"idempotency"`
	Applications  map[string]Application `json:"applications"`
}

func emptyState() diskState {
	return diskState{1, map[string]record{}, map[string]idempotency{}, map[string]Application{}}
}
func (d diskState) clone() diskState {
	c := emptyState()
	for k, v := range d.Records {
		v.Incident = v.Incident.clone()
		v.Moderation = append([]moderationEvent(nil), v.Moderation...)
		c.Records[k] = v
	}
	for k, v := range d.Idempotency {
		c.Idempotency[k] = v
	}
	for k, v := range d.Applications {
		c.Applications[k] = v.Clone()
	}
	return c
}

type rateWindow struct {
	At    time.Time
	Count int
}
type Store struct {
	mu             sync.Mutex
	directory      string
	lock           *os.File
	resolver       *resolver
	data           diskState
	now            func() time.Time
	write          func(diskState) error
	failed, closed bool
	rate           map[string]rateWindow
	global         rateWindow
}

// Open takes an exclusive advisory OS lock for its complete lifetime. Two
// Managers may share this Store; two processes cannot overwrite its snapshot.
func Open(directory string, g *world.Graph) (*Store, error) {
	r, err := newResolver(g)
	if err != nil {
		return nil, err
	}
	if directory == "" {
		return nil, ErrInvalid
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, fmt.Errorf("incident directory: %w", err)
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, ErrUnavailable
	}
	if err := os.Chmod(directory, 0700); err != nil {
		return nil, ErrUnavailable
	}
	f, err := os.OpenFile(filepath.Join(directory, "writer.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, ErrUnavailable
	}
	if err = f.Chmod(0600); err != nil {
		_ = f.Close()
		return nil, ErrUnavailable
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("incident store already has a writer: %w", err)
	}
	s := &Store{directory: directory, lock: f, resolver: r, data: emptyState(), now: time.Now, rate: map[string]rateWindow{}}
	s.write = s.writeAtomic
	defer func() {
		if err != nil {
			_ = s.Close()
		}
	}()
	path := filepath.Join(directory, "snapshot.json")
	if info, statErr := os.Lstat(path); statErr == nil {
		if !info.Mode().IsRegular() || info.Size() > 64<<20 {
			err = ErrUnavailable
			return nil, err
		}
		var file *os.File
		file, err = os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return nil, err
		}
		d := json.NewDecoder(io.LimitReader(file, 64<<20))
		d.DisallowUnknownFields()
		err = d.Decode(&s.data)
		if err == nil && d.Decode(new(any)) != io.EOF {
			err = ErrUnavailable
		}
		_ = file.Close()
		if err != nil || !validDiskState(s.data) {
			err = fmt.Errorf("incident snapshot is corrupt or incompatible")
			return nil, err
		}
		if err = os.Chmod(path, 0600); err != nil {
			return nil, err
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		err = statErr
		return nil, err
	}
	if err = s.refreshLocked(s.now().UTC()); err != nil {
		return nil, err
	}
	return s, nil
}

func validDiskState(d diskState) bool {
	if d.SchemaVersion != 1 || d.Records == nil || d.Idempotency == nil || d.Applications == nil || len(d.Records) > maxRecords || len(d.Idempotency) > maxRecords*2 || len(d.Applications) > maxRecords {
		return false
	}
	for id, r := range d.Records {
		i := r.Incident
		if !ValidID(id) || i.IncidentID != id || i.SchemaVersion != 1 || !validType(i.IncidentType) || !validStatus(i.VerificationStatus) || !oneOf(i.SourceType, "citizen", "synthetic", "official") || !coordinates(r.RawLatitude, r.RawLongitude) || !coordinates(i.Latitude, i.Longitude) || len(i.AffectedEdgeIDs) < 1 || len(i.AffectedEdgeIDs) > 5 || i.GraphVersion == "" || i.ReceivedAt.IsZero() || i.UpdatedAt.IsZero() || i.EventTime.IsZero() || i.ExpiresAt.IsZero() || i.ExpiresAt.Before(i.ReceivedAt) || !finite(i.SnapDistanceM) || i.SnapDistanceM < 0 || i.SnapDistanceM > MaxSnapDistanceM || utf8.RuneCountInString(i.Description) > 500 || i.EvidenceMetadata.AttachmentCount != 0 || i.EvidenceMetadata.StorageStatus != "not_supported" {
			return false
		}
	}
	for _, r := range d.Records {
		if utf8.RuneCountInString(r.Incident.ModerationNote) > 280 || len(r.Moderation) > 32 { return false }
		if source := r.Incident.OfficialSource; source != nil && (!validOfficialSource(source.Title, source.URL) || source.RecordedAt.IsZero()) { return false }
		for _, event := range r.Moderation {
			if event.At.IsZero() || event.Reviewer == "" || !validStatus(event.Status) || !validStatus(event.PreviousStatus) || utf8.RuneCountInString(event.Note) > 280 { return false }
			if source := event.OfficialSource; source != nil && (!validOfficialSource(source.Title, source.URL) || source.RecordedAt.IsZero()) { return false }
		}
	}
	for k, v := range d.Idempotency {
		if len(k) != 64 || len(v.BodyHash) != 64 {
			return false
		}
		if _, ok := d.Records[v.IncidentID]; !ok {
			return false
		}
	}
	for key, a := range d.Applications {
		if !ValidID(a.ApplicationID) || !ValidID(a.RunID) || !ValidID(a.IncidentID) || key != applicationKey(a.RunID, a.IncidentID) || len(a.AffectedEdgeIDs) < 1 || len(a.AffectedEdgeIDs) > 5 || a.SimulationStep < 0 || a.ExpiresAtSimulationStep <= a.SimulationStep || !oneOf(a.Effect, "blocked", "caution") || !validStatus(a.VerificationStatusAtApplication) || !oneOf(a.SourceType, "citizen", "synthetic", "official") || a.AppliedAt.IsZero() {
			return false
		}
	}
	return true
}
func (s *Store) writeAtomic(data diskState) error {
	f, err := os.CreateTemp(s.directory, ".snapshot-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		err = json.NewEncoder(f).Encode(data)
	}
	if err == nil {
		info, statErr := f.Stat()
		if statErr != nil { err = statErr } else if info.Size() > 64<<20 { err = ErrUnavailable }
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(name, filepath.Join(s.directory, "snapshot.json")); err != nil {
		return err
	}
	dir, err := os.Open(s.directory)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func (s *Store) saveLocked(data diskState) error {
	if err := s.write(data); err != nil {
		s.failed = true
		return ErrUnavailable
	}
	s.data = data
	return nil
}
func (s *Store) healthyLocked() error {
	if s.closed || s.failed {
		return ErrUnavailable
	}
	return nil
}
func (s *Store) refreshLocked(now time.Time) error {
	if err := s.healthyLocked(); err != nil {
		return err
	}
	data := s.data.clone()
	changed := false
	for id, r := range data.Records {
		if !now.Before(r.Incident.ReceivedAt.Add(retention)) {
			delete(data.Records, id)
			changed = true
			continue
		}
		if !now.Before(r.Incident.ExpiresAt) && r.Incident.VerificationStatus != "expired" {
			r.Incident.VerificationStatus = "expired"
			r.Incident.UpdatedAt = now
			data.Records[id] = r
			changed = true
		}
	}
	for k, v := range data.Idempotency {
		if _, ok := data.Records[v.IncidentID]; !ok {
			delete(data.Idempotency, k)
			changed = true
		}
	}
	for k, a := range data.Applications {
		if !now.Before(a.AppliedAt.Add(retention)) {
			delete(data.Applications, k)
			changed = true
		}
	}
	if changed {
		return s.saveLocked(data)
	}
	return nil
}
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	err := syscall.Flock(int(s.lock.Fd()), syscall.LOCK_UN)
	closeErr := s.lock.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func (s *Store) Info() ServiceInfo {
	return ServiceInfo{true, 1, s.resolver.bounds, MaxDescriptionLength, MaxSnapDistanceM, Notice, false}
}
func (s *Store) Resolve(input Location) (Resolution, error) {
	s.mu.Lock()
	err := s.healthyLocked()
	s.mu.Unlock()
	if err != nil {
		return Resolution{}, err
	}
	return s.resolver.resolve(input)
}

// Description is plain text. HTML delimiters and control characters are removed
// before persistence; callers must still render it as text, never as markup.
func normalized(input Create) (Create, error) {
	if !utf8.ValidString(input.Description) || utf8.RuneCountInString(input.Description) > MaxDescriptionLength {
		return input, ErrInvalid
	}
	input.Description = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r == '<' || r == '>' || unicode.IsControl(r) {
			if r == '\n' || r == '\t' {
				return ' '
			}
			return -1
		}
		return r
	}, input.Description))
	input.Description = strings.Join(strings.Fields(input.Description), " ")
	if utf8.RuneCountInString(input.Description) < 5 || !validType(input.IncidentType) || !coordinates(input.Latitude, input.Longitude) || !oneOf(input.SeverityReported, "low", "moderate", "high", "unknown") || !oneOf(input.RoadPassabilityReported, "passable", "restricted", "blocked", "unknown") || !oneOf(input.LocationMethod, "manual", "device") || len(input.EdgeIDHint) > 120 || input.EventTime.IsZero() {
		return input, ErrInvalid
	}
	if input.EvidenceMetadata != nil && (input.EvidenceMetadata.AttachmentCount != 0 || input.EvidenceMetadata.StorageStatus != "not_supported") {
		return input, ErrInvalid
	}
	input.EventTime = input.EventTime.UTC()
	input.EvidenceMetadata = &EvidenceMetadata{0, "not_supported"}
	return input, nil
}
func (s *Store) rateAllowed(client string, now time.Time) bool {
	key := hash(client)
	for k, w := range s.rate {
		if !now.Before(w.At.Add(time.Minute)) {
			delete(s.rate, k)
		}
	}
	w := s.rate[key]
	if w.At.IsZero() {
		w.At = now
	}
	if !now.Before(s.global.At.Add(time.Minute)) {
		s.global = rateWindow{At: now}
	}
	if w.Count >= 10 || s.global.Count >= 100 || len(s.rate) >= 1024 && w.Count == 0 {
		return false
	}
	w.Count++
	s.global.Count++
	s.rate[key] = w
	return true
}

// Create validates first; its successful return follows fsync and atomic rename.
// Idempotent network retries are read before rate limiting or time-window checks.
func (s *Store) Create(input Create, key, source, client string) (Incident, bool, error) {
	input, err := normalized(input)
	if err != nil || !keyPattern.MatchString(key) || !oneOf(source, "citizen", "synthetic") {
		return Incident{}, false, ErrInvalid
	}
	body, _ := json.Marshal(input)
	bodyHash := hash(source + string(body))
	keyHash := hash(source + ":" + key)
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	if err = s.refreshLocked(now); err != nil {
		return Incident{}, false, err
	}
	if prior, ok := s.data.Idempotency[keyHash]; ok {
		if prior.BodyHash != bodyHash {
			return Incident{}, false, ErrConflict
		}
		return s.data.Records[prior.IncidentID].Incident.clone(), false, nil
	}
	if input.EventTime.After(now.Add(5*time.Minute)) || input.EventTime.Before(now.Add(-retention)) {
		return Incident{}, false, ErrInvalid
	}
	resolved, err := s.resolver.resolve(Location{input.Latitude, input.Longitude, input.EdgeIDHint})
	if err != nil || !resolved.Matched {
		return Incident{}, false, ErrInvalid
	}
	if !s.rateAllowed(client, now) {
		return Incident{}, false, ErrRateLimited
	}
	if len(s.data.Idempotency) >= maxRecords*2 {
		return Incident{}, false, ErrUnavailable
	}
	data := s.data.clone()
	var duplicate *Incident
	closestDuplicate := math.Inf(1)
	for _, r := range data.Records {
		i := r.Incident
		distance := metres(world.GeoPoint{Lat: r.RawLatitude, Lng: r.RawLongitude}, world.GeoPoint{Lat: input.Latitude, Lng: input.Longitude})
		if i.SourceType == source && i.IncidentType == input.IncidentType && i.VerificationStatus != "rejected" && i.VerificationStatus != "expired" && math.Abs(i.EventTime.Sub(input.EventTime).Seconds()) <= 300 && distance <= 30 && len(i.AffectedEdgeIDs) == 1 && i.AffectedEdgeIDs[0] == resolved.Candidates[0].EdgeID {
			if duplicate == nil || distance < closestDuplicate || distance == closestDuplicate && i.IncidentID < duplicate.IncidentID {
				copy := i.clone()
				duplicate = &copy
				closestDuplicate = distance
			}
		}
	}
	if duplicate != nil {
		data.Idempotency[keyHash] = idempotency{bodyHash, duplicate.IncidentID}
		if err = s.saveLocked(data); err != nil {
			return Incident{}, false, err
		}
		return duplicate.clone(), false, nil
	}
	if len(data.Records) >= maxRecords {
		return Incident{}, false, ErrUnavailable
	}
	id, err := NewID()
	if err != nil {
		return Incident{}, false, ErrUnavailable
	}
	i := Incident{SchemaVersion: 1, IncidentID: id, IncidentType: input.IncidentType, Latitude: math.Round(input.Latitude*1e4) / 1e4, Longitude: math.Round(input.Longitude*1e4) / 1e4, Description: input.Description, SeverityReported: input.SeverityReported, RoadPassabilityReported: input.RoadPassabilityReported, EventTime: input.EventTime, ReceivedAt: now, SourceType: source, VerificationStatus: "pending", EvidenceMetadata: EvidenceMetadata{0, "not_supported"}, AffectedEdgeIDs: []string{resolved.Candidates[0].EdgeID}, GraphVersion: s.resolver.version, SnapDistanceM: resolved.Candidates[0].DistanceM, LocationMethod: input.LocationMethod, LocationPrecisionM: 20, ExpiresAt: now.Add(24 * time.Hour), UpdatedAt: now}
	data.Records[id] = record{Incident: i, RawLatitude: input.Latitude, RawLongitude: input.Longitude}
	data.Idempotency[keyHash] = idempotency{bodyHash, id}
	if err = s.saveLocked(data); err != nil {
		return Incident{}, false, err
	}
	return i.clone(), true, nil
}
func (s *Store) Get(id string) (Incident, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(s.now().UTC()); err != nil {
		return Incident{}, err
	}
	r, ok := s.data.Records[id]
	if !ok {
		return Incident{}, ErrNotFound
	}
	return r.Incident.clone(), nil
}
func (s *Store) List(query Query) (List, error) {
	if query.Limit == 0 {
		query.Limit = 100
	}
	if !oneOf(query.MapVisibility, "", "active", "withdrawn") || query.Limit < 1 || query.Limit > 200 || query.Offset < 0 || query.Offset > 10000 || query.IncidentType != "" && !validType(query.IncidentType) || query.VerificationStatus != "" && !validStatus(query.VerificationStatus) || !query.Since.IsZero() && !query.Until.IsZero() && query.Since.After(query.Until) {
		return List{}, ErrInvalid
	}
	if b := query.BBox; b != nil && (!coordinates(b.MinLatitude, b.MinLongitude) || !coordinates(b.MaxLatitude, b.MaxLongitude) || b.MinLatitude > b.MaxLatitude || b.MinLongitude > b.MaxLongitude) {
		return List{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(s.now().UTC()); err != nil {
		return List{}, err
	}
	all := []Incident{}
	for _, r := range s.data.Records {
		i := r.Incident
		if (query.MapVisibility == "withdrawn") != i.MapWithdrawn {
			continue
		}
		if query.IncidentType != "" && i.IncidentType != query.IncidentType || query.VerificationStatus != "" && i.VerificationStatus != query.VerificationStatus || query.VerificationStatus == "" && query.MapVisibility != "withdrawn" && oneOf(i.VerificationStatus, "rejected", "expired") || query.BBox != nil && !within(*query.BBox, i.Latitude, i.Longitude) || !query.Since.IsZero() && i.EventTime.Before(query.Since) || !query.Until.IsZero() && i.EventTime.After(query.Until) || !query.ReceivedAfter.IsZero() && !i.ReceivedAt.After(query.ReceivedAfter) {
			continue
		}
		all = append(all, i.clone())
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].ReceivedAt.Equal(all[j].ReceivedAt) {
			return all[i].IncidentID < all[j].IncidentID
		}
		return all[i].ReceivedAt.After(all[j].ReceivedAt)
	})
	start := min(query.Offset, len(all))
	end := min(start+query.Limit, len(all))
	return List{all[start:end], len(all), query.Limit, query.Offset, end < len(all)}, nil
}
func validOfficialSource(title, value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && len(value) <= 2048 && utf8.RuneCountInString(strings.TrimSpace(title)) >= 3 && utf8.RuneCountInString(title) <= 160
}

func (s *Store) Review(id string, input StatusUpdate) (Incident, error) {
	input.Note = strings.TrimSpace(input.Note)
	if !oneOf(input.VerificationStatus, "pending", "corroborated", "verified", "rejected") || input.ExpectedUpdatedAt.IsZero() || utf8.RuneCountInString(input.Note) > 280 || input.MapWithdrawn != nil && !*input.MapWithdrawn {
		return Incident{}, ErrInvalid
	}
	if input.OfficialSource != nil && (!input.OfficialAck || !validOfficialSource(input.OfficialSource.Title, input.OfficialSource.URL) || input.VerificationStatus != "verified") {
		return Incident{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	if err := s.refreshLocked(now); err != nil {
		return Incident{}, err
	}
	r, ok := s.data.Records[id]
	if !ok {
		return Incident{}, ErrNotFound
	}
	if !r.Incident.UpdatedAt.Equal(input.ExpectedUpdatedAt) {
		return Incident{}, ErrConflict
	}
	if r.Incident.VerificationStatus == "expired" || r.Incident.MapWithdrawn {
		return Incident{}, ErrIneligible
	}
	if input.OfficialSource != nil && r.Incident.SourceType == "synthetic" {
		return Incident{}, ErrInvalid
	}
	if r.Incident.VerificationStatus == input.VerificationStatus && input.MapWithdrawn == nil && input.OfficialSource == nil && input.Note == "" {
		return r.Incident.clone(), nil
	}
	// Bound private audit without discarding earlier reviews. Retention remains
	// the existing seven days; retired records are not physically deleted here.
	if len(r.Moderation) >= 32 {
		return Incident{}, ErrConflict
	}
	data := s.data.clone()
	previous := r.Incident.VerificationStatus
	r.Incident.VerificationStatus = input.VerificationStatus
	if input.MapWithdrawn != nil {
		r.Incident.MapWithdrawn = *input.MapWithdrawn
	}
	if input.Note != "" {
		r.Incident.ModerationNote = input.Note
	}
	var accreditation *OfficialSource
	if input.OfficialSource != nil {
		accreditation = &OfficialSource{Title: strings.TrimSpace(input.OfficialSource.Title), URL: input.OfficialSource.URL, RecordedAt: now}
		r.Incident.OfficialSource = accreditation
	}
	r.Incident.UpdatedAt = now
	if !now.After(input.ExpectedUpdatedAt) {
		r.Incident.UpdatedAt = input.ExpectedUpdatedAt.Add(time.Nanosecond)
	}
	reviewer := input.Reviewer
	if reviewer == "" { reviewer = "internal" }
	r.Moderation = append(append([]moderationEvent(nil), r.Moderation...), moderationEvent{At: r.Incident.UpdatedAt, Reviewer: reviewer, PreviousStatus: previous, Status: input.VerificationStatus, Withdrawn: r.Incident.MapWithdrawn, Note: input.Note, OfficialSource: accreditation})
	data.Records[id] = r
	if err := s.saveLocked(data); err != nil {
		return Incident{}, err
	}
	return r.Incident.clone(), nil
}

func applicationKey(run, id string) string { return run + ":" + id }
func (s *Store) Application(run, id string) (Application, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(s.now().UTC()); err != nil {
		return Application{}, false, err
	}
	a, ok := s.data.Applications[applicationKey(run, id)]
	return a.Clone(), ok, nil
}

// ApplicationEdges refuses to move an observation to another street when a
// reduced graph omits its originally resolved OSM edge. The full graph remains
// available for such experiments; no nearest-node shortcut invents coverage.
func (s *Store) ApplicationEdges(id string, g *world.Graph) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(s.now().UTC()); err != nil {
		return nil, err
	}
	r, ok := s.data.Records[id]
	if !ok {
		return nil, ErrNotFound
	}
	if r.Incident.MapWithdrawn || oneOf(r.Incident.VerificationStatus, "rejected", "expired") {
		return nil, ErrIneligible
	}
	edges := map[string]world.GraphEdge{}
	for _, edge := range g.Edges {
		edges[edge.ID] = edge
	}
	for _, id := range r.Incident.AffectedEdgeIDs {
		edge, exists := edges[id]
		if !exists {
			return nil, fmt.Errorf("%w: la calle observada no pertenece a este grafo; selecciona el maestro completo", ErrInvalid)
		}
		points := edge.Geometry
		if len(points) < 2 {
			nodes := map[string]world.GraphNode{}
			for _, n := range g.Nodes {
				nodes[n.ID] = n
			}
			a, b := nodes[edge.From], nodes[edge.To]
			points = []world.GeoPoint{{Lat: a.Lat, Lng: a.Lng}, {Lat: b.Lat, Lng: b.Lng}}
		}
		d, _ := closest(world.GeoPoint{Lat: r.RawLatitude, Lng: r.RawLongitude}, points)
		if d > MaxSnapDistanceM {
			return nil, ErrInvalid
		}
	}
	return append([]string{}, r.Incident.AffectedEdgeIDs...), nil
}

// RecordApplication is the persistence barrier called by the Simulator before
// changing its experimental overlay. On failure the simulation remains intact.
func (s *Store) RecordApplication(a Application) (Application, error) {
	if !ValidID(a.ApplicationID) || !ValidID(a.RunID) || !ValidID(a.IncidentID) || a.SimulationStep < 0 || a.ExpiresAtSimulationStep-a.SimulationStep < 2 || a.ExpiresAtSimulationStep-a.SimulationStep > 10001 || !oneOf(a.Effect, "blocked", "caution") || len(a.AffectedEdgeIDs) < 1 || len(a.AffectedEdgeIDs) > 5 {
		return Application{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	if err := s.refreshLocked(now); err != nil {
		return Application{}, err
	}
	r, ok := s.data.Records[a.IncidentID]
	if !ok {
		return Application{}, ErrNotFound
	}
	if r.Incident.MapWithdrawn || oneOf(r.Incident.VerificationStatus, "rejected", "expired") {
		return Application{}, ErrIneligible
	}
	if !slices.Equal(r.Incident.AffectedEdgeIDs, a.AffectedEdgeIDs) {
		return Application{}, ErrInvalid
	}
	key := applicationKey(a.RunID, a.IncidentID)
	if _, ok := s.data.Applications[key]; ok {
		return Application{}, ErrConflict
	}
	if len(s.data.Applications) >= maxRecords {
		return Application{}, ErrUnavailable
	}
	a.SourceType = r.Incident.SourceType
	a.VerificationStatusAtApplication = r.Incident.VerificationStatus
	a.AppliedAt = now
	data := s.data.clone()
	data.Applications[key] = a.Clone()
	if err := s.saveLocked(data); err != nil {
		return Application{}, err
	}
	return a.Clone(), nil
}
