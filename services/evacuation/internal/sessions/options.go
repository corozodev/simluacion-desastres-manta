package sessions

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"strconv"
	"time"

	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/runlimits"
)

type Options struct {
	Origins                                       []string
	Logger                                        *slog.Logger
	Engine                                        decision.Options
	Clock                                         Clock
	MaxActive, MaxFullActive, MaxRetained         int
	MaxMemoryBytes                                int64
	DefaultTickInterval                           time.Duration
	DefaultMaxTicks                               int
	MinTicks                                      int // May be reduced only by internal callers (tests); production uses runlimits.MinTicks.
	IdleTTL, PausedTTL, CompletedTTL, MaxWallTime time.Duration
	RateLimitPerMinute, CreateLimitPerMinute      int
}

func DefaultOptions() Options {
	return Options{Engine: decision.Options{Prediction: true, RiskWeight: .6, PredictionWeight: 12}, MaxActive: 2, MaxFullActive: 1, MaxRetained: 8, MaxMemoryBytes: 128 << 20, DefaultTickInterval: 2 * time.Second, DefaultMaxTicks: runlimits.DefaultTicks, MinTicks: runlimits.MinTicks, IdleTTL: 2 * time.Minute, PausedTTL: 5 * time.Minute, CompletedTTL: 15 * time.Minute, MaxWallTime: 6 * time.Hour, RateLimitPerMinute: 120, CreateLimitPerMinute: 10}
}

func OptionsFromEnv() (Options, error) {
	o := DefaultOptions()
	ints := []struct {
		name     string
		target   *int
		min, max int
	}{
		{"SIM_MAX_ACTIVE", &o.MaxActive, 1, 16}, {"SIM_MAX_FULL_ACTIVE", &o.MaxFullActive, 0, 4}, {"SIM_MAX_RETAINED", &o.MaxRetained, 1, 128}, {"SIM_DEFAULT_MAX_TICKS", &o.DefaultMaxTicks, runlimits.MinTicks, runlimits.MaxTicks}, {"SIM_RATE_LIMIT_PER_MINUTE", &o.RateLimitPerMinute, 1, 10000}, {"SIM_CREATE_LIMIT_PER_MINUTE", &o.CreateLimitPerMinute, 1, 1000},
	}
	for _, v := range ints {
		if s := os.Getenv(v.name); s != "" {
			n, err := strconv.Atoi(s)
			if err != nil || n < v.min || n > v.max {
				return o, fmt.Errorf("invalid %s", v.name)
			}
			*v.target = n
		}
	}
	if s := os.Getenv("SIM_MAX_MEMORY_MB"); s != "" {
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil || n < 16 || n > 4096 {
			return o, fmt.Errorf("invalid SIM_MAX_MEMORY_MB")
		}
		o.MaxMemoryBytes = n << 20
	}
	for _, v := range []struct {
		name   string
		target *time.Duration
	}{
		{"SIM_DEFAULT_TICK_INTERVAL", &o.DefaultTickInterval}, {"SIM_IDLE_TTL", &o.IdleTTL}, {"SIM_PAUSED_TTL", &o.PausedTTL}, {"SIM_COMPLETED_TTL", &o.CompletedTTL}, {"SIM_MAX_WALL_TIME", &o.MaxWallTime},
	} {
		if s := os.Getenv(v.name); s != "" {
			d, err := time.ParseDuration(s)
			if err != nil || d <= 0 || d > 24*time.Hour {
				return o, fmt.Errorf("invalid %s", v.name)
			}
			*v.target = d
		}
	}
	return o, validateOptions(o)
}

func validateOptions(o Options) error {
	if o.MaxActive < 1 || o.MaxFullActive < 0 || o.MaxFullActive > o.MaxActive || o.MaxRetained < o.MaxActive || o.MaxMemoryBytes < 16<<20 || o.DefaultTickInterval < time.Second || o.DefaultTickInterval > 5*time.Second || o.MinTicks < 1 || o.MinTicks > runlimits.MinTicks || o.DefaultMaxTicks < o.MinTicks || o.DefaultMaxTicks > runlimits.MaxTicks || o.IdleTTL <= 0 || o.PausedTTL <= 0 || o.CompletedTTL <= 0 || o.MaxWallTime <= 0 || o.RateLimitPerMinute < 1 || o.CreateLimitPerMinute < 1 {
		return fmt.Errorf("invalid simulation manager limits")
	}
	return nil
}

func completeOptions(o Options) Options {
	if o.Logger == nil {
		o.Logger = slog.New(slog.NewJSONHandler(io.Discard, nil))
	}
	if o.Clock == nil {
		o.Clock = realClock{}
	}
	o.Origins = append([]string{}, o.Origins...)
	return o
}
