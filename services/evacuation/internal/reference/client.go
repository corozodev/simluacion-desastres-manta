package reference

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrProvider = errors.New("La fuente oficial no respondió con una colección completa y válida; se conserva la copia anterior.")

type Client struct {
	HTTP                           *http.Client
	susceptibility, events, portal string
	mu                             sync.Mutex
	metrics                        Metrics
}

func NewClient() *Client {
	return &Client{HTTP: &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, susceptibility: SusceptibilityURL, events: EventsURL, portal: "https://sgrportal.gestionderiesgos.gob.ec/portal/sharing/rest/content/items/"}
}
func (c *Client) Metrics() Metrics { c.mu.Lock(); defer c.mu.Unlock(); return c.metrics }
func (c *Client) get(ctx context.Context, endpoint string, q url.Values) ([]byte, error) {
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ErrProvider
			case <-time.After(200 * time.Millisecond):
			}
		}
		req, err := http.NewRequestWithContext(ctx, "GET", endpoint+"?"+q.Encode(), nil)
		if err != nil {
			return nil, ErrProvider
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "CoroDev-academic-reference/1.0")
		start := time.Now()
		resp, err := c.HTTP.Do(req)
		var raw []byte
		status := 0
		if err == nil {
			status = resp.StatusCode
			raw, err = io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024+1))
			_ = resp.Body.Close()
			if len(raw) > 4*1024*1024 {
				err = ErrProvider
			}
		}
		elapsed := float64(time.Since(start)) / float64(time.Millisecond)
		var envelope struct {
			Error json.RawMessage `json:"error"`
		}
		if err == nil && json.Unmarshal(raw, &envelope) != nil {
			err = ErrProvider
		}
		if len(envelope.Error) > 0 && string(envelope.Error) != "null" {
			err = ErrProvider
		}
		c.mu.Lock()
		c.metrics.Queries++
		c.metrics.ResponseBytes += uint64(len(raw))
		c.metrics.LastQueryMS = elapsed
		c.metrics.TotalQueryMS += elapsed
		if err != nil || status != 200 {
			c.metrics.ProviderErrors++
		}
		c.mu.Unlock()
		if err == nil && status == 200 {
			return raw, nil
		}
		if status >= 400 && status < 500 && status != 429 {
			return nil, ErrProvider
		}
	}
	return nil, ErrProvider
}

type metadata struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	Copyright    string `json:"copyrightText"`
	Capabilities string `json:"capabilities"`
	Formats      string `json:"supportedQueryFormats"`
	GeometryType string `json:"geometryType"`
	MaxRecords   int    `json:"maxRecordCount"`
	ItemID       string `json:"serviceItemId"`
	Fields       []struct {
		Name string `json:"name"`
		Type string `json:"type"`
	} `json:"fields"`
	Extent struct {
		SpatialReference struct {
			WKID int `json:"wkid"`
		} `json:"spatialReference"`
	} `json:"extent"`
	Advanced struct {
		Pagination bool `json:"supportsPagination"`
	} `json:"advancedQueryCapabilities"`
}

func (c *Client) metadata(ctx context.Context, endpoint string) (metadata, error) {
	raw, err := c.get(ctx, endpoint, url.Values{"f": {"json"}})
	var m metadata
	if err != nil || json.Unmarshal(raw, &m) != nil || !strings.Contains(m.Capabilities, "Query") || !strings.Contains(strings.ToLower(m.Formats), "geojson") || m.MaxRecords < 1 || m.MaxRecords > 100000 {
		return m, ErrProvider
	}
	return m, nil
}
func spatialQuery() url.Values {
	parts := []string{}
	for _, v := range Manta {
		parts = append(parts, strconv.FormatFloat(v, 'f', 7, 64))
	}
	return url.Values{"where": {"1=1"}, "geometry": {strings.Join(parts, ",")}, "geometryType": {"esriGeometryEnvelope"}, "inSR": {"4326"}, "spatialRel": {"esriSpatialRelIntersects"}}
}

type rawFeature struct {
	Type       string                     `json:"type"`
	ID         json.RawMessage            `json:"id"`
	Properties map[string]json.RawMessage `json:"properties"`
	Geometry   struct {
		Type        string          `json:"type"`
		Coordinates json.RawMessage `json:"coordinates"`
	} `json:"geometry"`
}

func (c *Client) features(ctx context.Context, endpoint, fields string, m metadata, acquisition *Acquisition) ([]rawFeature, error) {
	q := spatialQuery()
	if endpoint == c.susceptibility {
		q.Set("where", "sui IN ('ALTA','MEDIA','BAJA')")
	}
	q.Set("f", "json")
	q.Set("returnIdsOnly", "true")
	acquisition.Queries = append(acquisition.Queries, endpoint+"/query?"+q.Encode())
	raw, err := c.get(ctx, endpoint+"/query", q)
	if err != nil {
		return nil, err
	}
	var ids struct {
		Field string  `json:"objectIdFieldName"`
		IDs   []int64 `json:"objectIds"`
	}
	if json.Unmarshal(raw, &ids) != nil || ids.Field == "" || len(ids.IDs) > 500 {
		return nil, ErrProvider
	}
	sort.Slice(ids.IDs, func(i, j int) bool { return ids.IDs[i] < ids.IDs[j] })
	for i, v := range ids.IDs {
		if v < 0 || i > 0 && v == ids.IDs[i-1] {
			return nil, ErrProvider
		}
	}
	result := []rawFeature{}
	batch := min(50, m.MaxRecords)
	for start := 0; start < len(ids.IDs); start += batch {
		selected := ids.IDs[start:min(start+batch, len(ids.IDs))]
		values := []string{}
		for _, id := range selected {
			values = append(values, strconv.FormatInt(id, 10))
		}
		q = spatialQuery()
		if endpoint == c.susceptibility {
			q.Set("where", "sui IN ('ALTA','MEDIA','BAJA')")
		}
		q.Set("f", "geojson")
		q.Set("objectIds", strings.Join(values, ","))
		q.Set("outFields", fields)
		q.Set("outSR", "4326")
		q.Set("returnGeometry", "true")
		q.Set("geometryPrecision", "6")
		if endpoint == c.susceptibility {
			q.Set("maxAllowableOffset", strconv.FormatFloat(GeneralizationDegrees, 'f', 4, 64))
		}
		acquisition.Queries = append(acquisition.Queries, endpoint+"/query?"+q.Encode())
		raw, err = c.get(ctx, endpoint+"/query", q)
		if err != nil {
			return nil, fmt.Errorf("bounded feature batch %d: %w", start, err)
		}
		var fc struct {
			Type     string       `json:"type"`
			Features []rawFeature `json:"features"`
			Exceeded bool         `json:"exceededTransferLimit"`
		}
		if json.Unmarshal(raw, &fc) != nil || fc.Type != "FeatureCollection" || fc.Exceeded || len(fc.Features) != len(selected) {
			return nil, ErrProvider
		}
		found := map[int64]bool{}
		for _, f := range fc.Features {
			var id int64
			if json.Unmarshal(f.Properties[ids.Field], &id) != nil || found[id] {
				return nil, ErrProvider
			}
			valid := false
			for _, expected := range selected {
				if expected == id {
					valid = true
				}
			}
			if !valid {
				return nil, ErrProvider
			}
			found[id] = true
			result = append(result, f)
		}
	}
	return result, nil
}
func text(raw json.RawMessage, maxLen int) (string, error) {
	var s string
	if json.Unmarshal(raw, &s) != nil || len(s) > maxLen || strings.ContainsAny(s, "<>\x00") {
		return "", ErrProvider
	}
	return s, nil
}
func fieldID(f rawFeature, key string) (string, error) {
	var id int64
	if json.Unmarshal(f.Properties[key], &id) != nil || id < 0 {
		return "", ErrProvider
	}
	return strconv.FormatInt(id, 10), nil
}
func version(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func normalizeGeometry(f rawFeature) (Geometry, error) {
	g := Geometry{Type: "MultiPolygon"}
	switch f.Geometry.Type {
	case "Polygon":
		var p [][]Position
		if json.Unmarshal(f.Geometry.Coordinates, &p) != nil {
			return g, ErrProvider
		}
		g.Coordinates = [][][]Position{p}
	case "MultiPolygon":
		if json.Unmarshal(f.Geometry.Coordinates, &g.Coordinates) != nil {
			return g, ErrProvider
		}
	default:
		return g, ErrProvider
	}
	return g, nil
}
func (c *Client) refine(ctx context.Context, id string, a *Acquisition) (Geometry, error) {
	q := spatialQuery()
	q.Set("f", "geojson")
	q.Set("where", "sui IN ('ALTA','MEDIA','BAJA')")
	q.Set("objectIds", id)
	q.Set("outFields", "FID,sui,anno")
	q.Set("returnGeometry", "true")
	q.Set("outSR", "4326")
	q.Set("geometryPrecision", "8")
	a.Queries = append(a.Queries, c.susceptibility+"/query?"+q.Encode())
	raw, err := c.get(ctx, c.susceptibility+"/query", q)
	if err != nil {
		return Geometry{}, err
	}
	var fc struct {
		Type     string       `json:"type"`
		Features []rawFeature `json:"features"`
	}
	if json.Unmarshal(raw, &fc) != nil || fc.Type != "FeatureCollection" || len(fc.Features) != 1 {
		return Geometry{}, ErrProvider
	}
	got, err := fieldID(fc.Features[0], "FID")
	if err != nil || got != id {
		return Geometry{}, ErrProvider
	}
	return normalizeGeometry(fc.Features[0])
}
func (c *Client) provenance(ctx context.Context, m metadata, category, endpoint string) (Provenance, error) {
	p := Provenance{Category: category, Source: "Secretaría Nacional de Gestión de Riesgos — " + m.Name, URL: endpoint, ConsultedAt: time.Now().UTC(), Attribution: m.Copyright, License: "El portal no declara una licencia de reutilización explícita. Se conserva la atribución de la fuente.", OriginalCRS: fmt.Sprintf("EPSG:%d", m.Extent.SpatialReference.WKID), OutputCRS: "EPSG:4326", SourceYears: []int{}}
	raw, err := c.get(ctx, c.portal+m.ItemID, url.Values{"f": {"json"}})
	if err != nil {
		return p, err
	}
	var item struct {
		Modified int64  `json:"modified"`
		License  string `json:"licenseInfo"`
	}
	if json.Unmarshal(raw, &item) != nil {
		return p, ErrProvider
	}
	if item.Modified > 0 {
		v := time.UnixMilli(item.Modified).UTC()
		p.PortalModifiedAt = &v
	}
	if strings.TrimSpace(item.License) != "" {
		p.License = item.License
	}
	return p, nil
}
func (c *Client) Fetch(ctx context.Context) (result Bundle, resultErr error) {
	start := time.Now()
	initialErrors := c.Metrics().ProviderErrors
	defer func() {
		c.mu.Lock()
		if resultErr != nil && c.metrics.ProviderErrors == initialErrors {
			c.metrics.ProviderErrors++
		}
		c.metrics.LastRefreshMS = float64(time.Since(start)) / float64(time.Millisecond)
		c.mu.Unlock()
	}()
	b := Bundle{SchemaVersion: 1, Acquisition: Acquisition{Strategy: "bounded-bbox-IDs-then-batches; no pagination assumed", Queries: []string{}}}
	m, err := c.metadata(ctx, c.susceptibility)
	if err != nil || m.GeometryType != "esriGeometryPolygon" || m.Extent.SpatialReference.WKID != 32717 {
		return b, ErrProvider
	}
	hasClass, hasID := false, false
	for _, f := range m.Fields {
		hasClass = hasClass || f.Name == "sui" && f.Type == "esriFieldTypeString"
		hasID = hasID || f.Name == "FID" && f.Type == "esriFieldTypeOID"
	}
	if !hasClass || !hasID {
		return b, ErrProvider
	}
	b.Acquisition.SusceptibilityPagination = m.Advanced.Pagination
	b.Acquisition.MaxRecordCount = m.MaxRecords
	features, err := c.features(ctx, c.susceptibility, "FID,sui,anno", m, &b.Acquisition)
	if err != nil {
		return b, err
	}
	p, err := c.provenance(ctx, m, "official_reference", SusceptibilityURL)
	if err != nil {
		return b, err
	}
	p.Attribution = "CONAGE 2024 — resoluciones 006, 007 y 008-CONAGE-2024. " + p.Attribution
	p.TemporalScope = "Susceptibilidad territorial estructural: sólo ALTA, MEDIA y BAJA. SIN y NO APLICABLE no se reclasifican. No representa inundación actual, profundidad ni probabilidad. Generalización de hasta 0,0001 grados; anillos degenerados se recuperan con mayor detalle."
	b.Susceptibility = Collection{SchemaVersion: 1, Type: "FeatureCollection", BBox: Manta, Features: []Feature{}, Provenance: p, GeneralizationDegrees: GeneralizationDegrees}
	years := map[int]bool{}
	for _, f := range features {
		id, e := fieldID(f, "FID")
		if e != nil {
			return b, e
		}
		class, e := text(f.Properties["sui"], 40)
		if e != nil || class != "ALTA" && class != "MEDIA" && class != "BAJA" {
			return b, fmt.Errorf("unexpected susceptibility class for feature %s: %w", id, ErrProvider)
		}
		g, e := normalizeGeometry(f)
		if e != nil {
			return b, e
		}
		n, e := ValidateGeometry(g)
		if e != nil {
			g, e = c.refine(ctx, id, &b.Acquisition)
			if e != nil {
				return b, e
			}
			n, e = ValidateGeometry(g)
			if e != nil {
				return b, fmt.Errorf("feature %s geometry after refinement: %w", id, e)
			}
		}
		var year int
		_ = json.Unmarshal(f.Properties["anno"], &year)
		if year != 0 && (year < 1900 || year > 2100) {
			return b, ErrProvider
		}
		if year > 0 {
			years[year] = true
		}
		b.Susceptibility.Features = append(b.Susceptibility.Features, Feature{Type: "Feature", ID: id, Properties: Properties{ObjectID: id, Susceptibility: class, SourceYear: year}, Geometry: g})
		b.Susceptibility.VertexCount += n
	}
	for y := range years {
		b.Susceptibility.Provenance.SourceYears = append(b.Susceptibility.Provenance.SourceYears, y)
	}
	sort.Ints(b.Susceptibility.Provenance.SourceYears)
	b.Susceptibility.FeatureCount = len(features)
	b.Susceptibility.Provenance.DatasetVersion = "sngr-susceptibility-" + version(b.Susceptibility.Features)
	em, err := c.metadata(ctx, c.events)
	if err != nil || em.GeometryType != "esriGeometryPoint" || em.Extent.SpatialReference.WKID != 4326 {
		return b, ErrProvider
	}
	b.Acquisition.EventsPagination = em.Advanced.Pagination
	ef, err := c.features(ctx, c.events, "objectid,canton,evento,fechadelevento,fechadecierredelevento,fechaultimaactualizacion", em, &b.Acquisition)
	if err != nil {
		return b, err
	}
	ep, err := c.provenance(ctx, em, "official_observation", EventsURL)
	if err != nil {
		return b, err
	}
	ep.Attribution = "Secretaría Nacional de Gestión de Riesgos — colección EVENTOS_X_LLUVIAS."
	ep.TemporalScope = "Fechas declaradas de eventos históricos; N/A en cierre no demuestra actividad actual. No modifica carreteras ni rutas."
	b.RainEvents = RainEvents{SchemaVersion: 1, Events: []RainEvent{}, Provenance: ep}
	for _, f := range ef {
		var pos Position
		if f.Geometry.Type != "Point" || json.Unmarshal(f.Geometry.Coordinates, &pos) != nil || !finite(pos[0]) || !finite(pos[1]) || pos[0] < Manta[0] || pos[0] > Manta[2] || pos[1] < Manta[1] || pos[1] > Manta[3] {
			return b, ErrProvider
		}
		id, e := fieldID(f, "objectid")
		if e != nil {
			return b, e
		}
		values := []string{}
		for _, key := range []string{"evento", "canton", "fechadelevento", "fechadecierredelevento"} {
			v, e := text(f.Properties[key], 255)
			if e != nil {
				return b, e
			}
			values = append(values, v)
		}
		if _, e := time.Parse("2006-01-02", values[2]); e != nil {
			return b, ErrProvider
		}
		update := ""
		if raw := f.Properties["fechaultimaactualizacion"]; len(raw) > 0 && string(raw) != "null" {
			update, e = text(raw, 255)
			if e != nil {
				return b, e
			}
			if _, e := time.Parse("2006-01-02", update); e == nil && update > b.RainEvents.Provenance.DeclaredUpdateDate {
				b.RainEvents.Provenance.DeclaredUpdateDate = update
			}
		}
		b.RainEvents.Events = append(b.RainEvents.Events, RainEvent{ObjectID: id, Event: values[0], Canton: values[1], EventDate: values[2], ClosedDate: values[3], Latitude: pos[1], Longitude: pos[0], DeclaredUpdateDate: update})
	}
	b.RainEvents.Provenance.DatasetVersion = "sngr-rain-events-" + version(b.RainEvents.Events)
	if err := Validate(b); err != nil {
		return b, ErrProvider
	}
	return b, nil
}
