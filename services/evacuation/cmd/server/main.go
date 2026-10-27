package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/control"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/sessions"
)

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
func boolean(name string, fallback bool) (bool, error) {
	if value := os.Getenv(name); value != "" {
		v, err := strconv.ParseBool(value)
		if err != nil {
			return false, fmt.Errorf("invalid %s", name)
		}
		return v, nil
	}
	return fallback, nil
}
func run(logger *slog.Logger) error {
	key := os.Getenv("API_KEY")
	if strings.TrimSpace(key) == "" {
		return errors.New("API_KEY is required; keep it outside clients and repository")
	}
	dataDir, scenarioDir := env("GRAPH_DATA_DIR", "data"), env("SCENARIO_DIR", "scenarios/urban")
	if path := os.Getenv("GRAPH_PATH"); path != "" && filepath.Clean(path) != filepath.Join(dataDir, "manta-v2.json") {
		return errors.New("GRAPH_PATH must select the competition catalog source; use the authenticated controller for other presets")
	}
	round := env("INITIAL_ROUND", "round1")
	if path := os.Getenv("SCENARIO_PATH"); path != "" {
		round = strings.TrimSuffix(filepath.Base(path), ".json")
		if filepath.Clean(path) != filepath.Join(scenarioDir, round+".json") {
			return errors.New("SCENARIO_PATH must select an approved urban round")
		}
	}
	if value := os.Getenv("SIM_TURNS"); value != "" && value != "150" {
		return errors.New("catalog rounds require SIM_TURNS=150")
	}
	concurrency := 0
	if value := os.Getenv("SIM_CONCURRENCY"); value != "" {
		v, err := strconv.Atoi(value)
		if err != nil || v < 1 || v > 200 {
			return errors.New("invalid SIM_CONCURRENCY")
		}
		concurrency = v
	}
	var seed *int64
	if value := os.Getenv("SIM_SEED"); value != "" {
		v, err := strconv.ParseInt(value, 10, 64)
		if err != nil || v < -9007199254740991 || v > 9007199254740991 {
			return errors.New("invalid SIM_SEED")
		}
		seed = &v
	}
	interval, err := time.ParseDuration(env("SIM_INTERVAL", "2s"))
	if err != nil || interval < 0 {
		return errors.New("invalid SIM_INTERVAL")
	}
	prediction, err := boolean("PREDICTION_ENABLED", true)
	if err != nil {
		return err
	}
	riskWeight, err := strconv.ParseFloat(env("RISK_WEIGHT", "0.6"), 64)
	if err != nil || riskWeight <= 0 || math.IsNaN(riskWeight) || math.IsInf(riskWeight, 0) {
		return errors.New("invalid RISK_WEIGHT")
	}
	predictionWeight, err := strconv.ParseFloat(env("PREDICTION_WEIGHT", "12"), 64)
	if err != nil || predictionWeight <= 0 || math.IsNaN(predictionWeight) || math.IsInf(predictionWeight, 0) {
		return errors.New("invalid PREDICTION_WEIGHT")
	}
	full, err := boolean("ENABLE_FULL_MODE", false)
	if err != nil {
		return err
	}
	expanded, err := boolean("ENABLE_EXPANDED_MODE", false)
	if err != nil {
		return err
	}
	autoStart, err := boolean("SIM_AUTOSTART", false)
	if err != nil {
		return err
	}
	if autoStart {
		return errors.New("SIM_AUTOSTART=true is disabled; simulations require an explicit start request")
	}
	sessionOptions, err := sessions.OptionsFromEnv()
	if err != nil {
		return err
	}
	localAdmin, err := boolean("ADMIN_ALLOW_INSECURE_LOOPBACK", false)
	if err != nil {
		return err
	}
	address := env("LISTEN_ADDR", "127.0.0.1:8080")
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	if localAdmin {
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return errors.New("insecure admin development requires a literal loopback listener")
		}
	}
	c, err := catalog.New(dataDir, scenarioDir, catalog.Options{EnableFull: full, EnableExpanded: expanded, Concurrency: concurrency})
	if err != nil {
		return err
	}
	origins := strings.Split(env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"), ",")
	sessionOptions.Origins = origins
	sessionOptions.Logger = logger
	sessionOptions.Engine = decision.Options{Prediction: prediction, RiskWeight: riskWeight, PredictionWeight: predictionWeight}
	publicSessions, err := sessions.New(c, sessionOptions)
	if err != nil {
		return err
	}
	defer publicSessions.Close()
	m, err := control.New(c, control.Options{DisableStart: true, APIKey: key, Origins: origins, Logger: logger, Engine: decision.Options{Prediction: prediction, RiskWeight: riskWeight, PredictionWeight: predictionWeight}, Interval: interval, Round: round, Seed: seed, AutoStart: autoStart, Admin: control.AdminOptions{Operator: os.Getenv("ADMIN_OPERATOR"), AccessHash: os.Getenv("ADMIN_ACCESS_HASH"), AllowInsecureLoopback: localAdmin}})
	if err != nil {
		return err
	}
	defer m.Close()
	network := "tcp"
	if ip := net.ParseIP(host); host == "" || ip != nil && ip.To4() != nil {
		network = "tcp4"
	}
	listener, err := net.Listen(network, address)
	if err != nil {
		return err
	}
	var legacy http.Handler = m
	if endpoint := os.Getenv("FLOOD_LAB_UPSTREAM"); endpoint != "" {
		target, e := url.Parse(endpoint)
		if e != nil || target.Scheme != "http" || target.Host != "127.0.0.1:8082" || target.User != nil || target.RawQuery != "" || target.Fragment != "" || target.Path != "" {
			return errors.New("FLOOD_LAB_UPSTREAM must be http://127.0.0.1:8082")
		}
		proxy := httputil.NewSingleHostReverseProxy(target)
		director := proxy.Director
		proxy.Director = func(r *http.Request) { director(r); r.Host = target.Host }
		legacy = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/lab/") || r.URL.Path == "/v1/incidents" || strings.HasPrefix(r.URL.Path, "/v1/incidents/") || strings.HasPrefix(r.URL.Path, "/v1/reference/") {
				proxy.ServeHTTP(w, r)
				return
			}
			m.ServeHTTP(w, r)
		})
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" || r.URL.Path == "/v1/simulations" || strings.HasPrefix(r.URL.Path, "/v1/simulations/") {
			publicSessions.ServeHTTP(w, r)
			return
		}
		legacy.ServeHTTP(w, r)
	})
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 2 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	actualHost, port, _ := net.SplitHostPort(listener.Addr().String())
	if actualHost == "" || actualHost == "0.0.0.0" {
		actualHost = "127.0.0.1"
	}
	if actualHost == "::" {
		actualHost = "::1"
	}
	info := m.Info()
	preset, _ := c.Preset("competition")
	cfg, _ := c.Config("competition", round, seed)
	logger.Info("backend ready", "url", "http://"+net.JoinHostPort(actualHost, port), "scenario", cfg.Name, "nodes", preset.Nodes, "edges", preset.Edges, "turn_interval", interval.String(), "mode", info.Mode, "admin_enabled", os.Getenv("ADMIN_ACCESS_HASH") != "")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-ctx.Done():
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			_ = listener.Close()
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
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("startup failed", "error", err.Error())
		os.Exit(1)
	}
}
