// Command flood-lab exposes only a local experimental control plane. It never
// changes the production competition process or the read-only phase 4A server.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"corodev/evacuation/internal/floodlab"
	"corodev/evacuation/internal/incidents"
	"corodev/evacuation/internal/reference"
)

func run() error {
	listen := flag.String("listen", "127.0.0.1:8082", "literal loopback address for the local laboratory")
	origin := flag.String("origin", "http://127.0.0.1:5173,http://localhost:5173", "explicit browser origins")
	dataDir := flag.String("data-dir", "data", "reviewed graph directory")
	scenarioDir := flag.String("scenario-dir", "scenarios/urban", "reviewed urban scenario directory")
	incidentDir := flag.String("incident-dir", "private/incidents", "persistent private directory for declared incidents (single writer)")
	referenceCache := flag.String("reference-cache", "private/reference.json", "validated official cache; missing/corrupt cache never blocks synthetic simulation")
	referenceOnline := flag.Bool("reference-online", false, "opt in to asynchronous official provider refresh")
	referenceBundle := flag.String("reference-bundle", "", "bundled verified snapshot, default data-dir/reference/manta-official.json; a missing file leaves synthetic mode available")
	flag.Parse()
	host, _, err := net.SplitHostPort(*listen)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("flood-lab requires a literal loopback listen address")
	}
	m, err := floodlab.New(*dataDir, *scenarioDir, strings.Split(*origin, ","))
	if err != nil {
		return err
	}
	master, err := m.Graph("full", "")
	if err != nil {
		_ = m.Close()
		return err
	}
	store, err := incidents.Open(*incidentDir, master)
	if err != nil {
		_ = m.Close()
		return err
	}
	defer store.Close()
	defer m.Close()
	if *referenceBundle == "" {
		*referenceBundle = filepath.Join(*dataDir, "reference", "manta-official.json")
	}
	refs := reference.New(*referenceCache, *referenceBundle, *referenceOnline)
	defer refs.Close()
	if err = m.SetReferenceService(refs); err != nil {
		return err
	}
	if *referenceOnline {
		refs.Refresh(context.Background())
	}
	if err = m.SetIncidentStore(store); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: m, ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	metricsDone := make(chan struct{})
	defer close(metricsDone)
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-metricsDone:
				return
			case <-ticker.C:
				_ = json.NewEncoder(os.Stdout).Encode(struct {
					Event   string             `json:"event"`
					Metrics floodlab.Telemetry `json:"metrics"`
				}{"lab_metrics", m.Telemetry()})
			}
		}
	}()
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"event": "ready", "url": "http://" + listener.Addr().String(), "scenario_type": "urban_flood", "local_only": true}); err != nil {
		_ = server.Close()
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-ctx.Done():
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdown); err != nil {
		_ = server.Close()
		return err
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
