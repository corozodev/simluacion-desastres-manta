package main

import (
	"io"
	"log/slog"
	"strings"
	"testing"
)

func TestExplicitAutostartIsRejectedBeforeOpeningListener(t *testing.T) {
	t.Setenv("API_KEY", "local-test-only-key")
	t.Setenv("SIM_AUTOSTART", "true")
	err := run(slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err == nil || !strings.Contains(err.Error(), "SIM_AUTOSTART=true is disabled") {
		t.Fatalf("unexpected startup: %v", err)
	}
}
