package sessions

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"corodev/evacuation/internal/graph"
)

func customShelters(t *testing.T, m *Manager) []CustomShelter {
	t.Helper()
	g, err := m.catalog.Graph("competition")
	if err != nil {
		t.Fatal(err)
	}
	result := []CustomShelter{}
	used := map[string]bool{}
	for _, sh := range g.Shelters {
		result = append(result, CustomShelter{ID: sh.ID, NodeID: sh.NodeID, Capacity: sh.Capacity})
		used[sh.NodeID] = true
	}
	for _, n := range g.Nodes {
		if used[n.ID] {
			continue
		}
		edited := g.Clone()
		edited.Shelters[0].NodeID = n.ID
		if graph.Validate(edited) == nil {
			result[0].NodeID = n.ID
			return result
		}
	}
	t.Fatal("no alternate reachable node")
	return nil
}

func TestCustomSheltersPreserveSpawnAndRestart(t *testing.T) {
	m, _ := testManager(t, nil)
	a := create(t, m, request(2), "custom-baseline-key")
	r := request(2)
	r.Config.CustomShelters = customShelters(t, m)
	expected := append([]CustomShelter(nil), r.Config.CustomShelters...)
	b := create(t, m, r, "custom-alternate-key")
	sa, sb := state(t, m, a), state(t, m, b)
	for _, s := range []*State{&sa, &sb} {
		for i := range s.Snapshot.Survivors {
			s.Snapshot.Survivors[i].PlannedRoute = nil
			s.Snapshot.Survivors[i].TargetShelterID = ""
		}
	}
	if !reflect.DeepEqual(sa.Snapshot.Survivors, sb.Snapshot.Survivors) || !reflect.DeepEqual(sa.Snapshot.Zombies, sb.Snapshot.Zombies) {
		t.Fatal("custom shelters changed original population or threat RNG")
	}
	if sb.GraphVersion != sa.GraphVersion || sb.Snapshot.Shelters[0].NodeID != expected[0].NodeID {
		t.Fatal("overlay must retain static graph identity and use edited node")
	}
	// Both input and returned metadata are detached from retained execution config.
	r.Config.CustomShelters[0].NodeID = "tampered-input"
	b.Config.CustomShelters[0].NodeID = "tampered-output"
	retained, err := m.Get(b.SimulationID, b.AccessToken)
	if err != nil || !reflect.DeepEqual(retained.Config.CustomShelters, expected) {
		t.Fatal("mutable custom shelter config", err)
	}
	if _, err := m.Control(b.SimulationID, b.AccessToken, "cancel"); err != nil {
		t.Fatal(err)
	}
	restarted, err := m.Restart(context.Background(), b.SimulationID, b.AccessToken, "custom-restart-key", "test-ip")
	if err != nil || !reflect.DeepEqual(restarted.Config.CustomShelters, expected) {
		t.Fatal("restart discarded custom shelters", err)
	}
}

func TestCustomSheltersHTTPValidationAndPrivateOverlay(t *testing.T) {
	m, _ := testManager(t, nil)
	server := httptest.NewServer(m)
	defer server.Close()
	custom := customShelters(t, m)
	call := func(req CreateRequest, key string) (*http.Response, Metadata) {
		t.Helper()
		raw, _ := json.Marshal(req)
		request, _ := http.NewRequest("POST", server.URL+"/v1/simulations", strings.NewReader(string(raw)))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Idempotency-Key", key)
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var info Metadata
		_ = json.NewDecoder(response.Body).Decode(&info)
		return response, info
	}
	for _, test := range []struct {
		name   string
		change func([]CustomShelter) []CustomShelter
	}{
		{"count", func(c []CustomShelter) []CustomShelter { return c[:3] }},
		{"node", func(c []CustomShelter) []CustomShelter { c[0].NodeID = "absent"; return c }},
		{"duplicate", func(c []CustomShelter) []CustomShelter { c[0].NodeID = c[1].NodeID; return c }},
		{"capacity", func(c []CustomShelter) []CustomShelter { c[0].Capacity = 201; return c }},
		{"id", func(c []CustomShelter) []CustomShelter { c[0].ID = "invented"; return c }},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := request(2)
			r.Config.CustomShelters = test.change(append([]CustomShelter(nil), custom...))
			response, _ := call(r, "custom-invalid-"+test.name)
			if response.StatusCode != 400 {
				t.Fatal(response.StatusCode)
			}
		})
	}
	r := request(2)
	r.Config.CustomShelters = custom
	response, created := call(r, "custom-http-create-key")
	if response.StatusCode != 201 {
		t.Fatal(response.StatusCode)
	}
	req, _ := http.NewRequest("GET", server.URL+"/v1/simulations/"+created.SimulationID+"/state", nil)
	req.Header.Set("Authorization", "Bearer "+created.AccessToken)
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var state State
	if err := json.NewDecoder(response.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || state.AccessToken != "" || state.Snapshot.Shelters[0].NodeID != custom[0].NodeID {
		t.Fatal("private HTTP state lost custom overlay")
	}
}

func TestCustomSheltersPauseResumeDeterminism(t *testing.T) {
	m, c := testManager(t, nil)
	req := request(3)
	req.Config.CustomShelters = customShelters(t, m)
	a := create(t, m, req, "custom-determinism-a")
	b := create(t, m, req, "custom-determinism-b")
	if _, err := m.Control(b.SimulationID, b.AccessToken, "pause"); err != nil {
		t.Fatal(err)
	}
	for tick := 1; tick <= 3; tick++ {
		advance(t, m, c, a, tick)
	}
	await(t, func() bool { return m.Stats().Active == 1 })
	if _, err := m.Control(b.SimulationID, b.AccessToken, "resume"); err != nil {
		t.Fatal(err)
	}
	for tick := 1; tick <= 3; tick++ {
		advance(t, m, c, b, tick)
	}
	if !reflect.DeepEqual(logical(state(t, m, a)), logical(state(t, m, b))) {
		t.Fatal("custom shelter pause/resume changed logical world outcomes")
	}
}
