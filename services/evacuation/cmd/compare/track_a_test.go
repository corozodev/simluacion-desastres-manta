package main

import (
	"path/filepath"
	"testing"

	"corodev/evacuation/internal/evaluation"
	"corodev/evacuation/internal/world"
)

func TestTrackAResumeRejectsCorruptHTTPCompletion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "http.json")
	cases := []experimentCase{{ID: "one", InitialHash: "initial-one"}, {ID: "two", InitialHash: "initial-two"}}
	probe := runEvidence{Case: cases[0], Fingerprint: "frozen", Status: "completed", Result: evaluation.Result{
		Metrics: world.Metrics{Turns: 3}, InitialStateSHA256: cases[0].InitialHash, FinalState: &world.WorldSnapshot{Turn: 3},
	}}
	if err := atomicJSON(path, httpValidation{Complete: true, Probes: []runEvidence{probe}}); err != nil {
		t.Fatal(err)
	}
	if _, err := loadHTTPValidation(path, "frozen", cases); err == nil {
		t.Fatal("accepted a missing second probe as complete")
	}
	if err := atomicJSON(path, httpValidation{Probes: []runEvidence{probe}}); err != nil {
		t.Fatal(err)
	}
	partial, err := loadHTTPValidation(path, "frozen", cases)
	if err != nil || partial.Complete || len(partial.Probes) != 1 {
		t.Fatalf("lost resumable valid probe: %v", err)
	}
	if _, err := loadHTTPValidation(path, "another configuration", cases); err == nil {
		t.Fatal("accepted another experiment")
	}
	if err := atomicJSON(path, httpValidation{Probes: []runEvidence{probe, probe}}); err != nil {
		t.Fatal(err)
	}
	if _, err := loadHTTPValidation(path, "frozen", cases); err == nil {
		t.Fatal("accepted duplicated probe")
	}
}

func TestTrackAResumePinsResourcesWithoutVolatileMemoryReadings(t *testing.T) {
	env := map[string]any{"go": "test", "gomaxprocs": 2, "address_space_limit_bytes": uint64(8 << 30), "gomemlimit": "7GiB", "/proc/self/status": "VmRSS:\t100 kB\nCpus_allowed_list:\t0-1\n"}
	before := hash(stableEnvironment(env))
	env["/proc/self/status"] = "VmRSS:\t200 kB\nCpus_allowed_list:\t0-1\n"
	if hash(stableEnvironment(env)) != before {
		t.Fatal("transient RSS prevents recovery")
	}
	env["/proc/self/status"] = "VmRSS:\t200 kB\nCpus_allowed_list:\t2-3\n"
	if hash(stableEnvironment(env)) == before {
		t.Fatal("changed CPU affinity accepted")
	}
	env["/proc/self/status"] = "VmRSS:\t100 kB\nCpus_allowed_list:\t0-1\n"
	env["address_space_limit_bytes"] = uint64(4 << 30)
	if hash(stableEnvironment(env)) == before {
		t.Fatal("changed memory limit accepted")
	}
}
