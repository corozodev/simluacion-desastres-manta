package world

import "testing"

func TestFleetSnapshotCopiesOwnPathsPassengersAndMetrics(t *testing.T) {
	input := WorldSnapshot{Fleet: []RescueVehicle{{ID: "V", CurrentNode: "B", Path: []string{"A", "B"}, PassengerIDs: []string{"S"}, Capacity: 4}}, FleetMetrics: &RescueFleetMetrics{Pickups: 1}}
	store := NewStore()
	store.Publish(input)
	input.Fleet[0].Path[0] = "tampered"
	input.Fleet[0].PassengerIDs[0] = "tampered"
	input.FleetMetrics.Pickups = 99
	for _, load := range []func() (WorldSnapshot, bool){store.Load, store.LoadCompact, store.LoadForDecision} {
		w, _ := load()
		if w.Fleet[0].Path[0] != "A" || w.Fleet[0].PassengerIDs[0] != "S" || w.FleetMetrics.Pickups != 1 {
			t.Fatal("publisher or reader changed immutable fleet snapshot")
		}
		w.Fleet[0].Path[0] = "reader mutation"
		w.Fleet[0].PassengerIDs[0] = "reader mutation"
		w.FleetMetrics.Pickups = 100
	}
}
