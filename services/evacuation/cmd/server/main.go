package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/coordination"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/simulation"
)

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
func run(logger *slog.Logger) error {
	key := os.Getenv("API_KEY")
	if strings.TrimSpace(key) == "" {
		return errors.New("API_KEY is required; generate a local secret and keep it outside clients and repository")
	}
	g, err := graph.Load(env("GRAPH_PATH", "data/manta-v2.json"))
	if err != nil {
		return err
	}
	cfg, err := simulation.LoadConfig(env("SCENARIO_PATH", "scenarios/urban/round1.json"))
	if err != nil {
		return err
	}
	for name, destination := range map[string]*int{"SIM_TURNS": &cfg.Turns, "SIM_CONCURRENCY": &cfg.Concurrency} {
		if value := os.Getenv(name); value != "" {
			parsed, err := strconv.Atoi(value)
			if err != nil || parsed < 1 {
				return fmt.Errorf("invalid %s", name)
			}
			*destination = parsed
		}
	}
	if value := os.Getenv("SIM_SEED"); value != "" {
		cfg.Seed, err = strconv.ParseInt(value, 10, 64)
		if err != nil {
			return errors.New("invalid SIM_SEED")
		}
	}
	interval, err := time.ParseDuration(env("SIM_INTERVAL", "2s"))
	if err != nil || interval < 0 {
		return errors.New("invalid SIM_INTERVAL")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	prediction, err := strconv.ParseBool(env("PREDICTION_ENABLED", "true"))
	if err != nil {
		return errors.New("invalid PREDICTION_ENABLED")
	}
	riskWeight, err := strconv.ParseFloat(env("RISK_WEIGHT", "0.6"), 64)
	if err != nil || riskWeight <= 0 || math.IsNaN(riskWeight) || math.IsInf(riskWeight, 0) {
		return errors.New("invalid RISK_WEIGHT")
	}
	predictionWeight, err := strconv.ParseFloat(env("PREDICTION_WEIGHT", "12"), 64)
	if err != nil || predictionWeight <= 0 || math.IsNaN(predictionWeight) || math.IsInf(predictionWeight, 0) {
		return errors.New("invalid PREDICTION_WEIGHT")
	}
	engine := decision.NewWithOptions(decision.Options{Prediction: prediction, RiskWeight: riskWeight, PredictionWeight: predictionWeight})
	app, err := application.NewWithOptions(g, cfg, env("LISTEN_ADDR", "127.0.0.1:8080"), key, strings.Split(env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"), ","), logger, application.Options{Engine: engine, Planner: coordination.New(engine, coordination.Options{})})
	if err != nil {
		return err
	}
	defer app.Close()
	logger.Info("backend ready", "url", app.BaseURL, "scenario", cfg.Name, "nodes", len(g.Nodes), "edges", len(g.Edges), "turn_interval", interval.String())
	go func() {
		err := app.Simulator.Run(ctx, cfg.Turns, interval)
		if err != nil && ctx.Err() == nil {
			logger.Error("simulation stopped", "error", err.Error())
			stop()
			return
		}
		if ctx.Err() == nil {
			logger.Info("simulation finished; final snapshot remains available", "metrics", app.Simulator.Snapshot().Metrics)
		}
	}()
	<-ctx.Done()
	return nil
}
func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("startup failed", "error", err.Error())
		os.Exit(1)
	}
}
