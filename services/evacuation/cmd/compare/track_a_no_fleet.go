package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"corodev/evacuation/internal/application"
	"corodev/evacuation/internal/catalog"
	"corodev/evacuation/internal/decision"
	"corodev/evacuation/internal/evaluation"
	"corodev/evacuation/internal/world"
)

func withoutFleet(reference experimentCase) (experimentCase, error) {
	if reference.Round != "round3" || !reference.Config.RescueFleet {
		return experimentCase{}, fmt.Errorf("reference must be R3 with fleet")
	}
	c := reference
	c.ReferenceRunID = reference.ID
	c.ID = reference.ID + "-no-fleet"
	c.Config.RescueFleet = false
	return c, nil
}

// Compare native source bytes rather than infer equivalence from a Git HEAD.
// Runner-only changes may differ; every internal Go file and go.mod must match.
func verifiedNativeSource(referenceDirectory string) (string, error) {
	f, e := os.Open(filepath.Join(referenceDirectory, "frozen-source.tar.gz"))
	if e != nil {
		return "", e
	}
	defer f.Close()
	gz, e := gzip.NewReader(f)
	if e != nil {
		return "", e
	}
	defer gz.Close()
	archive := tar.NewReader(gz)
	sources := map[string]string{}
	for {
		h, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		rel := strings.TrimPrefix(h.Name, "services/evacuation/")
		if rel != "go.mod" && !(strings.HasPrefix(rel, "internal/") && strings.HasSuffix(rel, ".go")) {
			continue
		}
		if filepath.Clean(rel) != rel || strings.HasPrefix(rel, "/") || h.Size > 8<<20 {
			return "", fmt.Errorf("invalid source archive entry")
		}
		original, err := io.ReadAll(io.LimitReader(archive, 8<<20))
		if err != nil {
			return "", err
		}
		live, err := os.ReadFile(rel)
		if err != nil {
			return "", err
		}
		if !bytes.Equal(original, live) {
			return "", fmt.Errorf("native source differs from reference: %s", rel)
		}
		sources[rel] = string(live)
	}
	if _, ok := sources["go.mod"]; !ok {
		return "", fmt.Errorf("missing frozen native source")
	}
	e = filepath.WalkDir("internal", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && strings.HasSuffix(p, ".go") {
			if _, ok := sources[p]; !ok {
				return fmt.Errorf("native source was added since reference: %s", p)
			}
		}
		return nil
	})
	if e != nil {
		return "", e
	}
	return hash(sources), nil
}

func runTrackAR3NoFleet(directory, referenceDirectory string) error {
	abs, e := filepath.Abs(directory)
	if e != nil {
		return e
	}
	referenceAbs, e := filepath.Abs(referenceDirectory)
	if e != nil {
		return e
	}
	if abs == referenceAbs {
		return fmt.Errorf("control output must differ from reference")
	}
	if e = os.MkdirAll(directory, 0700); e != nil {
		return e
	}
	lock, e := os.OpenFile(filepath.Join(directory, "runner.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer lock.Close()
	if e = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		return fmt.Errorf("another experiment owns output: %w", e)
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	referenceBytes, e := os.ReadFile(filepath.Join(referenceDirectory, "manifest.json"))
	if e != nil {
		return e
	}
	var ref struct {
		Fingerprint string           `json:"fingerprint"`
		Cases       []experimentCase `json:"cases"`
		Environment map[string]any   `json:"environment"`
	}
	if e = json.Unmarshal(referenceBytes, &ref); e != nil {
		return e
	}
	completionBytes, e := os.ReadFile(filepath.Join(referenceDirectory, "completion.json"))
	if e != nil {
		return e
	}
	var completedReference struct {
		Completed   int    `json:"completed"`
		Turns       int    `json:"turns"`
		Fingerprint string `json:"fingerprint"`
	}
	if e = json.Unmarshal(completionBytes, &completedReference); e != nil {
		return e
	}
	if len(ref.Cases) != 36 || completedReference.Completed != 36 || completedReference.Turns != 5400 || completedReference.Fingerprint != ref.Fingerprint {
		return fmt.Errorf("reference experiment is incomplete")
	}
	nativeHash, e := verifiedNativeSource(referenceDirectory)
	if e != nil {
		return e
	}
	sourceHash, e := sourceDigest()
	if e != nil {
		return e
	}
	env := experimentEnvironment()
	if hash(stableEnvironment(env)) != hash(stableEnvironment(ref.Environment)) {
		return fmt.Errorf("resource/runtime environment differs from original experiment")
	}
	cat, e := catalog.New("data", "scenarios/urban", catalog.Options{EnableFull: true})
	if e != nil {
		return e
	}
	graphs := map[string]*world.Graph{}
	cases := []experimentCase{}
	for _, original := range ref.Cases {
		if original.Round != "round3" {
			continue
		}
		b, err := os.ReadFile(filepath.Join(referenceDirectory, "runs", original.ID+".json"))
		if err != nil {
			return err
		}
		var r runEvidence
		if err = json.Unmarshal(b, &r); err != nil {
			return err
		}
		if r.Status != "completed" || r.Fingerprint != ref.Fingerprint || r.Result.Metrics.Turns != 150 || r.Result.InitialStateSHA256 != original.InitialHash || hash(r.Case) != hash(original) {
			return fmt.Errorf("invalid reference run %s", original.ID)
		}
		c, err := withoutFleet(original)
		if err != nil {
			return err
		}
		g, ok := graphs[c.Profile]
		if !ok {
			g, err = cat.Graph(c.Profile)
			if err != nil {
				return err
			}
			graphs[c.Profile] = g
		}
		if hash(g) != c.GraphHash {
			return fmt.Errorf("graph differs from paired reference")
		}
		cases = append(cases, c)
	}
	if len(cases) != 18 {
		return fmt.Errorf("expected eighteen R3 control cases")
	}
	topology, e := os.ReadFile(filepath.Join(referenceDirectory, "topology.json"))
	if e != nil {
		return e
	}
	fp := hash(map[string]any{"kind": "track_a_r3_no_fleet", "schema": 1, "reference_fingerprint": ref.Fingerprint, "source_hash": sourceHash, "native_source_hash": nativeHash, "environment": stableEnvironment(env), "cases": cases, "topology_hash": hash(string(topology))})
	manifestPath := filepath.Join(directory, "manifest.json")
	if b, err := os.ReadFile(manifestPath); err == nil {
		var existing struct {
			Fingerprint string `json:"fingerprint"`
		}
		if json.Unmarshal(b, &existing) != nil || existing.Fingerprint != fp {
			return fmt.Errorf("control manifest differs; use another output directory")
		}
	} else if !os.IsNotExist(err) {
		return err
	} else {
		commit, _ := exec.Command("git", "rev-parse", "HEAD").Output()
		relative, _ := filepath.Rel(abs, referenceAbs)
		manifest := map[string]any{"kind": "track_a_r3_no_fleet", "fingerprint": fp, "reference_fingerprint": ref.Fingerprint, "reference_directory": relative, "code_commit": strings.TrimSpace(string(commit)), "source_hash": sourceHash, "native_source_sha256": nativeHash, "native_source_matches_reference": true, "created_at": time.Now().UTC().Format(time.RFC3339Nano), "environment": env, "cases": cases, "accelerated": true, "nominal_turn_ms": 2000, "methodology": "Eighteen sequential R3 controls cloned from completed reference cases; only RescueFleet changes from true to false. Native internal Go source/go.mod and graph hashes match frozen reference; initial survivor and all zombie spawns must match, including private sleepers. Same Go/resources and real authenticated loopback HTTP. No extra complete fleet runs or short probes."}
		if e = atomicJSON(manifestPath, manifest); e != nil {
			return e
		}
	}
	if e = os.WriteFile(filepath.Join(directory, "topology.json"), topology, 0600); e != nil {
		return e
	}
	preflight := map[string]any{}
	for _, c := range cases {
		group := c.Profile + "/" + c.Round + "/" + c.Level
		if _, ok := preflight[group]; ok {
			continue
		}
		key, err := application.EphemeralKey()
		if err != nil {
			return err
		}
		app, err := application.NewWithOptions(graphs[c.Profile], c.Config, "127.0.0.1:0", key, nil, nil, application.Options{Engine: decision.NewWithOptions(decision.Options{Algorithm: c.Algorithm, Prediction: true})})
		if err != nil {
			return err
		}
		d, w := app.Simulator.Diagnostics(), app.Simulator.Snapshot()
		closeErr := app.Close()
		if err = errors.Join(validatePopulation(c, d, w), closeErr); err != nil {
			return err
		}
		preflight[group] = map[string]any{"initial_hash": initialHash(d), "initial": d, "physical": access(graphs[c.Profile], w, false), "with_hordes": access(graphs[c.Profile], w, true)}
	}
	if e = atomicJSON(filepath.Join(directory, "preflight.json"), preflight); e != nil {
		return e
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	started := time.Now()
	completed := 0
	for _, c := range cases {
		if e = ctx.Err(); e != nil {
			return e
		}
		path := filepath.Join(directory, "runs", c.ID+".json")
		if b, err := os.ReadFile(path); err == nil {
			var old runEvidence
			if err = json.Unmarshal(b, &old); err != nil {
				return err
			}
			if old.Fingerprint != fp || hash(old.Case) != hash(c) {
				return fmt.Errorf("control checkpoint differs")
			}
			if old.Status == "completed" && old.Result.Metrics.Turns == 150 {
				completed++
				fmt.Printf("resume %s\n", c.ID)
				continue
			}
			if err = os.Rename(path, strings.TrimSuffix(path, ".json")+".attempt-"+time.Now().UTC().Format("20060102T150405.000000000")+".json"); err != nil {
				return err
			}
		} else if !os.IsNotExist(err) {
			return err
		}
		if e = atomicJSON(path, runEvidence{Case: c, Fingerprint: fp, Status: "running", Started: time.Now().UTC().Format(time.RFC3339Nano)}); e != nil {
			return e
		}
		r := executeCase(ctx, graphs[c.Profile], c, evaluation.RunOptions{}, fp)
		if r.Status == "completed" && r.Result.Metrics.Turns != 150 {
			r.Status = "failed"
			r.Failure = "not150turns"
		}
		if e = atomicJSON(path, r); e != nil {
			return e
		}
		if r.Status != "completed" {
			return fmt.Errorf("saved failed control %s: %s", c.ID, r.Failure)
		}
		completed++
		m := r.Result.Metrics
		fmt.Printf("%d/18 %s evacuated=%d alive=%d bitten=%d wall=%.3fs http_p95=%.3fms\n", completed, c.ID, m.Evacuated, m.Evacuated+m.Active, m.Bitten, r.Result.ElapsedMS/1000, m.HTTPP95MS)
	}
	return atomicJSON(filepath.Join(directory, "completion.json"), map[string]any{"completed": completed, "turns": completed * 150, "fingerprint": fp, "reference_fingerprint": ref.Fingerprint, "invocation_seconds": time.Since(started).Seconds(), "finished_at": time.Now().UTC().Format(time.RFC3339Nano)})
}
