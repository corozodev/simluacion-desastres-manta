// Package httpapi serves read-only snapshots and deterministic movement decisions.
package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"strings"
	"time"

	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/world"
)

type Options struct {
	APIKey          string
	DecisionTimeout time.Duration
	AllowedOrigins  []string
	Logger          *slog.Logger
	Observe         func(RequestTiming)
	Metadata        func() *world.SimulationInfo
}

// RequestTiming is server-side instrumentation; client HTTP latency is measured
// independently by the simulator, including transport and decoding.
type RequestTiming struct {
	Path       string  `json:"path"`
	SnapshotMS float64 `json:"snapshot_ms"`
	DecisionMS float64 `json:"decision_ms"`
	TotalMS    float64 `json:"total_ms"`
}

type api struct {
	store        *world.Store
	engine       world.DecisionEngine
	index        *graph.Index
	graphVersion string
	key          [32]byte
	options      Options
}

type errorBody struct {
	Error errorInfo `json:"error"`
}
type errorInfo struct {
	Code      string        `json:"code"`
	Message   string        `json:"message"`
	RequestID string        `json:"requestId"`
	Details   []errorDetail `json:"details"`
}
type errorDetail struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// New indexes a validated immutable graph. No endpoint mutates simulation state.
func New(store *world.Store, engine world.DecisionEngine, g *world.Graph, options Options) (http.Handler, error) {
	if store == nil || engine == nil || strings.TrimSpace(options.APIKey) == "" {
		return nil, errors.New("store, engine and API key are required")
	}
	index, err := graph.New(g)
	if err != nil {
		return nil, err
	}
	if len(g.Shelters) != 4 {
		return nil, errors.New("competition HTTP graph requires exactly four shelters")
	}
	if options.DecisionTimeout == 0 {
		options.DecisionTimeout = 450 * time.Millisecond
	}
	if options.DecisionTimeout < time.Millisecond || options.DecisionTimeout > 500*time.Millisecond {
		return nil, errors.New("decision timeout must be between 1 and 500 ms")
	}
	if options.Logger == nil {
		options.Logger = slog.New(slog.NewJSONHandler(io.Discard, nil))
	}
	options.AllowedOrigins = append([]string{}, options.AllowedOrigins...)
	for i, origin := range options.AllowedOrigins {
		options.AllowedOrigins[i] = strings.TrimSpace(origin)
	}
	a := &api{store: store, engine: engine, index: index, graphVersion: g.Version, key: sha256.Sum256([]byte(options.APIKey)), options: options}
	return http.HandlerFunc(a.serve), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, status int, code, message, requestID string) {
	writeJSON(w, status, errorBody{Error: errorInfo{Code: code, Message: message, RequestID: requestID, Details: []errorDetail{}}})
}

func (a *api) serve(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	timing := RequestTiming{Path: r.URL.Path}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		fail(w, 500, "INTERNAL_ERROR", "No se pudo procesar la solicitud.", "unavailable")
		return
	}
	requestID := hex.EncodeToString(random[:])
	w.Header().Set("x-request-id", requestID)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	defer func() {
		if recovered := recover(); recovered != nil {
			a.options.Logger.Error("request failed", "request_id", requestID)
			fail(w, 500, "INTERNAL_ERROR", "No se pudo procesar la solicitud.", requestID)
		}
		a.options.Logger.Debug("http request", "method", r.Method, "path", r.URL.Path, "request_id", requestID, "duration_ms", float64(time.Since(started).Microseconds())/1000)
		if a.options.Observe != nil {
			timing.TotalMS = float64(time.Since(started)) / float64(time.Millisecond)
			a.options.Observe(timing)
		}
	}()
	if origin := r.Header.Get("Origin"); origin != "" {
		w.Header().Add("Vary", "Origin")
		for _, allowed := range a.options.AllowedOrigins {
			if allowed == origin {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Expose-Headers", "x-request-id")
				break
			}
		}
	}
	if r.Method == http.MethodOptions {
		if w.Header().Get("Access-Control-Allow-Origin") == "" {
			fail(w, 403, "UNAUTHORIZED", "Origen no autorizado.", requestID)
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, x-api-key")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	method := "GET"
	switch r.URL.Path {
	case "/paso":
		method = "POST"
	case "/estado", "/grafo", "/healthz", "/v1/scenario":
	default:
		fail(w, 404, "NOT_FOUND", "El recurso solicitado no existe.", requestID)
		return
	}
	if r.Method != method {
		w.Header().Set("Allow", method)
		fail(w, 405, "METHOD_NOT_ALLOWED", "Método no permitido.", requestID)
		return
	}
	if r.URL.Path == "/paso" {
		// The same budget covers snapshot acquisition, body reads and routing.
		// A context alone cannot interrupt a net/http request-body read.
		deadline := started.Add(a.options.DecisionTimeout)
		ctx, cancel := context.WithDeadline(r.Context(), deadline)
		defer cancel()
		r = r.WithContext(ctx)
		controller := http.NewResponseController(w)
		_ = controller.SetReadDeadline(deadline)
		// Leave an expired deadline in place while net/http finishes/drains the
		// request; it resets deadlines before reading the next keep-alive request.
	}
	if r.URL.Path == "/healthz" {
		writeJSON(w, 200, map[string]string{"status": "ok", "service": "corodev-evacuation", "version": "0.1.0"})
		return
	}
	// Authenticate before looking up survivors or revealing snapshot readiness.
	if r.URL.Path == "/paso" {
		key := sha256.Sum256([]byte(r.Header.Get("x-api-key")))
		if subtle.ConstantTimeCompare(key[:], a.key[:]) != 1 {
			fail(w, 401, "UNAUTHORIZED", "Credenciales no válidas.", requestID)
			return
		}
	}
	snapshotStarted := time.Now()
	snapshot, ready := a.store.Load()
	timing.SnapshotMS = float64(time.Since(snapshotStarted)) / float64(time.Millisecond)
	if !ready || snapshot.Graph == nil || snapshot.GraphVersion != a.graphVersion {
		fail(w, 503, "UNAVAILABLE", "El estado todavía no está disponible.", requestID)
		return
	}
	switch r.URL.Path {
	case "/v1/scenario":
		if snapshot.Scenario == nil {
			fail(w, 404, "NOT_FOUND", "Esta ronda no tiene un escenario de inundación.", requestID)
			return
		}
		writeJSON(w, 200, snapshot.Scenario)
	case "/estado":
		if a.options.Metadata != nil {
			snapshot.Simulation = a.options.Metadata()
		}
		writeJSON(w, 200, snapshot)
	case "/grafo":
		writeJSON(w, 200, snapshot.Graph)
	case "/paso":
		a.step(w, r, snapshot, requestID, &timing)
	}
}

func (a *api) step(w http.ResponseWriter, r *http.Request, snapshot world.WorldSnapshot, requestID string, timing *RequestTiming) {
	if r.Context().Err() != nil {
		fail(w, 504, "TIMEOUT", "La decisión superó el tiempo disponible.", requestID)
		return
	}
	if contentType := r.Header.Get("Content-Type"); contentType != "" {
		media, _, err := mime.ParseMediaType(contentType)
		if err != nil || media != "application/json" {
			fail(w, 400, "VALIDATION_ERROR", "Se requiere un cuerpo JSON válido.", requestID)
			return
		}
	}
	var input struct {
		SurvivorID  *string `json:"sobrevivienteId"`
		CurrentNode *string `json:"nodoActual"`
		Turn        *int    `json:"turno"`
	}
	var fields map[string]json.RawMessage
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	if err := decoder.Decode(&fields); err != nil {
		if readExpired(r, err) {
			fail(w, 504, "TIMEOUT", "La decisión superó el tiempo disponible.", requestID)
			return
		}
		fail(w, 400, "VALIDATION_ERROR", "Se requiere un cuerpo JSON válido.", requestID)
		return
	}
	trailing := decoder.Decode(new(any))
	if readExpired(r, trailing) {
		fail(w, 504, "TIMEOUT", "La decisión superó el tiempo disponible.", requestID)
		return
	}
	// encoding/json struct matching is case-insensitive; check exact wire names
	// explicitly so variants such as "Turno" cannot bypass the shared schema.
	if trailing != io.EOF || len(fields) != 3 || fields["sobrevivienteId"] == nil || fields["nodoActual"] == nil || fields["turno"] == nil || json.Unmarshal(fields["sobrevivienteId"], &input.SurvivorID) != nil || json.Unmarshal(fields["nodoActual"], &input.CurrentNode) != nil || json.Unmarshal(fields["turno"], &input.Turn) != nil || input.SurvivorID == nil || input.CurrentNode == nil || input.Turn == nil || len(*input.SurvivorID) == 0 || len(*input.SurvivorID) > 100 || len(*input.CurrentNode) == 0 || len(*input.CurrentNode) > 100 || *input.Turn < 0 {
		fail(w, 400, "VALIDATION_ERROR", "Revisa los datos enviados.", requestID)
		return
	}
	var survivor world.Survivor
	found := false
	for _, candidate := range snapshot.Survivors {
		if candidate.ID == *input.SurvivorID {
			survivor = candidate
			found = true
			break
		}
	}
	if _, exists := a.index.Node(*input.CurrentNode); !found || !exists {
		fail(w, 404, "NOT_FOUND", "El recurso solicitado no existe.", requestID)
		return
	}
	if survivor.CurrentNode != *input.CurrentNode || survivor.Status != world.Active || snapshot.Turn != *input.Turn {
		fail(w, 409, "CONFLICT", "La solicitud no corresponde al estado actual.", requestID)
		return
	}
	ctx := r.Context()
	if ctx.Err() != nil {
		fail(w, 504, "TIMEOUT", "La decisión superó el tiempo disponible.", requestID)
		return
	}
	decisionStarted := time.Now()
	decision := a.engine.NextStep(ctx, snapshot, survivor)
	timing.DecisionMS = float64(time.Since(decisionStarted)) / float64(time.Millisecond)
	if ctx.Err() != nil {
		fail(w, 504, "TIMEOUT", "La decisión superó el tiempo disponible.", requestID)
		return
	}
	blocked := make(map[string]bool, len(snapshot.BlockedEdges))
	for _, id := range snapshot.BlockedEdges {
		blocked[id] = true
	}
	next := decision.NextNode
	if !a.index.CanMove(survivor.CurrentNode, next, blocked) {
		next = survivor.CurrentNode
	}
	writeJSON(w, 200, world.StepResponse{NextNode: next})
}

func readExpired(r *http.Request, err error) bool {
	var netError net.Error
	return r.Context().Err() != nil || (errors.As(err, &netError) && netError.Timeout())
}
