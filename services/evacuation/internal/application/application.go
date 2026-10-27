// Package application wires a single authoritative simulator to its real HTTP API.
package application

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"time"

	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/httpapi"
	"corodev/evacuation/internal/simulation"
	"corodev/evacuation/internal/world"
)

type App struct {
	Store     *world.Store
	Simulator *simulation.Simulator
	BaseURL   string
	server    *http.Server
	client    *simulation.HTTPDecisionClient
	done      chan error
}

func EphemeralKey() (string, error) {
	var key [32]byte
	if _, err := rand.Read(key[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(key[:]), nil
}

func New(g *world.Graph, cfg simulation.Config, address, key string, origins []string, logger *slog.Logger) (*App, error) {
	engine := decision.New()
	return NewWithOptions(g, cfg, address, key, origins, logger, Options{Engine: engine, Planner: coordination.New(engine, coordination.Options{})})
}

type Options struct {
	Engine   world.DecisionEngine
	Planner  world.TurnPlanner
	Observe  func(httpapi.RequestTiming)
	Metadata func() *world.SimulationInfo
}

// NewWithOptions allows controlled offline evaluations without changing HTTP.
func NewWithOptions(g *world.Graph, cfg simulation.Config, address, key string, origins []string, logger *slog.Logger, options Options) (*App, error) {
	store := world.NewStore()
	engine := options.Engine
	if engine == nil {
		engine = decision.New()
	}
	handler, err := httpapi.New(store, engine, g, httpapi.Options{APIKey: key, AllowedOrigins: origins, Logger: logger, Observe: options.Observe, Metadata: options.Metadata})
	if err != nil {
		return nil, err
	}
	requestedHost, _, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	network := "tcp"
	// Go may widen an IPv4 wildcard to a dual-stack listener and report ::.
	// Respect explicit IPv4 intent so self HTTP works in IPv6-disabled Docker.
	requestedIP := net.ParseIP(requestedHost)
	if requestedHost == "" || (requestedIP != nil && requestedIP.To4() != nil) {
		network = "tcp4"
	}
	listener, err := net.Listen(network, address)
	if err != nil {
		return nil, err
	}
	host, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	if host == "" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	if host == "::" {
		host = "::1"
	}
	baseURL := "http://" + net.JoinHostPort(host, port)
	client, err := simulation.NewHTTPDecisionClient(baseURL, key, 500*time.Millisecond)
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	sim, err := simulation.New(g, store, cfg, client)
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	if options.Planner != nil {
		sim.SetPlanner(options.Planner)
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 2 * time.Second, WriteTimeout: time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
	app := &App{Store: store, Simulator: sim, BaseURL: baseURL, server: server, client: client, done: make(chan error, 1)}
	go func() { app.done <- server.Serve(listener) }()
	return app, nil
}

// ServeHTTP reuses the exact read/decision handler behind the run controller.
// Each simulator still calls its own independent loopback HTTP server.
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a.server.Handler.ServeHTTP(w, r)
}

func (a *App) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := a.server.Shutdown(ctx)
	a.client.CloseIdleConnections()
	if err != nil {
		_ = a.server.Close()
	}
	<-a.done
	return err
}
