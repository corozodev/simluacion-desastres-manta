package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// Only the logger goroutine writes stdout. A full queue never stalls /paso:
// the cumulative loss marker then makes percentile coverage explicitly incomplete.
type accessEvent struct {
	Timestamp    time.Time `json:"timestamp"`
	TimestampMS  int64     `json:"timestamp_ms"`
	Event        string    `json:"event"`
	Method       string    `json:"method"`
	Route        string    `json:"route"`
	Status       int       `json:"status"`
	DurationMS   float64   `json:"duration_ms"`
	SnapshotMS   float64   `json:"snapshot_ms"`
	DecisionMS   float64   `json:"decision_ms"`
	Outcome      string    `json:"outcome"`
	Scope        string    `json:"scope"`
	RunID        string    `json:"run_id,omitempty"`
	GraphVersion string    `json:"graph_version"`
}

type accessLog struct {
	queue   chan accessEvent
	stop    chan struct{}
	done    chan struct{}
	once    sync.Once
	closed  atomic.Bool
	seen    atomic.Uint64
	dropped atomic.Uint64
}

var processAccessLog = sync.OnceValues(func() (*accessLog, error) {
	value := os.Getenv("PASO_HTTP_LOG_ENABLED")
	if value == "" {
		return nil, nil
	}
	enabled, err := strconv.ParseBool(value)
	if err != nil {
		return nil, errors.New("invalid PASO_HTTP_LOG_ENABLED")
	}
	if !enabled {
		return nil, nil
	}
	l := &accessLog{queue: make(chan accessEvent, 4096), stop: make(chan struct{}), done: make(chan struct{})}
	go l.write()
	return l, nil
})

func (l *accessLog) record(event accessEvent) {
	l.seen.Add(1)
	if l.closed.Load() {
		l.dropped.Add(1)
		return
	}
	select {
	case l.queue <- event:
	default:
		l.dropped.Add(1)
	}
}

func (l *accessLog) write() {
	defer close(l.done)
	encoder := json.NewEncoder(os.Stdout)
	started := time.Now().UTC()
	var emitted, failed uint64
	write := func(event accessEvent) {
		if encoder.Encode(event) == nil {
			emitted++
		} else {
			failed++
		}
	}
	status := func(final bool) {
		_ = encoder.Encode(map[string]any{"event": "paso_http_log_status", "timestamp": time.Now().UTC(), "process_started_at": started, "attempted": l.seen.Load(), "emitted": emitted, "dropped": l.dropped.Load(), "write_errors": failed, "queued": len(l.queue), "final": final, "sampling": "none"})
	}
	status(false)
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case event := <-l.queue:
			write(event)
		case <-ticker.C:
			status(false)
		case <-l.stop:
			for {
				select {
				case event := <-l.queue:
					write(event)
				default:
					status(true)
					return
				}
			}
		}
	}
}

// Call only after the process has stopped its HTTP servers and simulations.
// The bounded wait avoids holding service shutdown on an unavailable log sink.
func CloseAccessLog() {
	l, _ := processAccessLog()
	if l == nil {
		return
	}
	l.once.Do(func() { l.closed.Store(true); close(l.stop) })
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	select {
	case <-l.done:
	case <-timer.C:
	}
}

type observedResponse struct {
	http.ResponseWriter
	status     int
	writeError bool
}

func (w *observedResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *observedResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *observedResponse) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(body)
	w.writeError = w.writeError || err != nil
	return n, err
}

func accessOutcome(ctx context.Context, w *observedResponse, panicked, deadlineReached bool) string {
	switch {
	case panicked:
		return "panic"
	// A disconnected peer can also produce a 504 from the existing body reader.
	// Before the local budget expires, retain that cancellation distinction.
	case !deadlineReached && errors.Is(ctx.Err(), context.Canceled):
		return "cancelled"
	case w.status == 408 || w.status == 504 || errors.Is(ctx.Err(), context.DeadlineExceeded):
		return "timeout"
	case errors.Is(ctx.Err(), context.Canceled):
		return "cancelled"
	case w.writeError:
		return "write_error"
	case w.status >= 400:
		return "http_error"
	default:
		return "ok"
	}
}
