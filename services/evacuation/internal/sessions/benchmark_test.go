package sessions

import (
	"context"
	"fmt"
	"runtime"
	"testing"
)

func BenchmarkSessionCreate(b *testing.B) {
	for _, profile := range []string{"BASE", "FULL_MANTA"} {
		b.Run(profile, func(b *testing.B) {
			_ = testCatalog(b)
			b.ReportAllocs()
			b.ResetTimer()
			for n := 0; n < b.N; n++ {
				b.StopTimer()
				m, _ := testManager(b, nil)
				r := request(3)
				r.GraphProfile = profile
				r.Config.Survivors = pointer(200)
				b.StartTimer()
				i, err := m.CreateAndStart(context.Background(), r, fmt.Sprintf("benchmark-create-%08d", n), "benchmark")
				if err != nil {
					b.Fatal(err)
				}
				b.StopTimer()
				_, _ = m.Control(i.SimulationID, i.AccessToken, "cancel")
				_ = m.Close()
				b.StartTimer()
			}
		})
	}
}

func BenchmarkSessionSnapshot(b *testing.B) {
	for _, scenario := range []string{"zombie_outbreak", "urban_flood"} {
		for _, profile := range []string{"BASE", "FULL_MANTA"} {
			b.Run(scenario+"/"+profile, func(b *testing.B) {
				m, _ := testManager(b, nil)
				r := request(3)
				r.GraphProfile = profile
				r.Scenario = scenario
				r.Config.Survivors = pointer(200)
				i := create(b, m, r, "benchmark-snapshot-key")
				b.ReportAllocs()
				b.ResetTimer()
				for n := 0; n < b.N; n++ {
					_, err := m.GetSnapshot(i.SimulationID, i.AccessToken, false)
					if err != nil {
						b.Fatal(err)
					}
				}
			})
		}
	}
}

// No simulation clock is advanced: benchmark invokes the exact same serialized
// turn adapter directly, which still sends real authenticated loopback HTTP.
func BenchmarkSessionTurn(b *testing.B) {
	for _, scenario := range []string{"zombie_outbreak", "urban_flood"} {
		for _, profile := range []string{"BASE", "FULL_MANTA"} {
			b.Run(scenario+"/"+profile, func(b *testing.B) {
				m, _ := testManager(b, nil)
				r := request(150)
				r.GraphProfile = profile
				r.Scenario = scenario
				r.Config.Survivors = pointer(200)
				i := create(b, m, r, "benchmark-turn-create-key")
				s, err := m.lookup(i.SimulationID, i.AccessToken, false)
				if err != nil {
					b.Fatal(err)
				}
				runtime.GC()
				var before, after runtime.MemStats
				runtime.ReadMemStats(&before)
				g0 := runtime.NumGoroutine()
				b.ReportAllocs()
				b.ResetTimer()
				for n := 0; n < b.N; n++ {
					if n >= 150 {
						b.Fatal("use -benchtime=3x or another count<=150")
					}
					if _, performed := m.advanceTurn(s); !performed {
						b.Fatal("turn was not executed")
					}
				}
				b.StopTimer()
				runtime.ReadMemStats(&after)
				if after.HeapAlloc >= before.HeapAlloc {
					b.ReportMetric(float64(after.HeapAlloc-before.HeapAlloc), "heap-growth-bytes")
				}
				b.ReportMetric(float64(runtime.NumGoroutine()-g0), "goroutine-delta")
				b.ReportMetric(float64(after.HeapAlloc), "heap-bytes")
			})
		}
	}
}
