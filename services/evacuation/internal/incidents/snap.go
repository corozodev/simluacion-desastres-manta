package incidents

import (
	"math"
	"sort"

	"corodev/evacuation/internal/world"
)

type road struct {
	id, kind, from, to string
	points             []world.GeoPoint
}
type resolver struct {
	version string
	bounds  Bounds
	roads   []road
}

func newResolver(g *world.Graph) (*resolver, error) {
	if g == nil || g.Version == "" || len(g.Nodes) < 2 || len(g.Edges) == 0 {
		return nil, ErrInvalid
	}
	r := &resolver{version: g.Version, bounds: Bounds{MinLatitude: 90, MinLongitude: 180, MaxLatitude: -90, MaxLongitude: -180}}
	nodes := map[string]world.GraphNode{}
	for _, n := range g.Nodes {
		if !coordinates(n.Lat, n.Lng) {
			return nil, ErrInvalid
		}
		nodes[n.ID] = n
		r.bounds.MinLatitude = math.Min(r.bounds.MinLatitude, n.Lat)
		r.bounds.MaxLatitude = math.Max(r.bounds.MaxLatitude, n.Lat)
		r.bounds.MinLongitude = math.Min(r.bounds.MinLongitude, n.Lng)
		r.bounds.MaxLongitude = math.Max(r.bounds.MaxLongitude, n.Lng)
	}
	for _, e := range g.Edges {
		a, aok := nodes[e.From]
		b, bok := nodes[e.To]
		if !aok || !bok {
			return nil, ErrInvalid
		}
		p := append([]world.GeoPoint{}, e.Geometry...)
		if len(p) < 2 {
			p = []world.GeoPoint{{Lat: a.Lat, Lng: a.Lng}, {Lat: b.Lat, Lng: b.Lng}}
		}
		for _, point := range p {
			if !coordinates(point.Lat, point.Lng) {
				return nil, ErrInvalid
			}
		}
		r.roads = append(r.roads, road{e.ID, e.RoadType, e.From, e.To, p})
	}
	return r, nil
}
func finite(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) }
func coordinates(lat, lng float64) bool {
	return finite(lat) && finite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}
func within(b Bounds, lat, lng float64) bool {
	return lat >= b.MinLatitude && lat <= b.MaxLatitude && lng >= b.MinLongitude && lng <= b.MaxLongitude
}
func metres(a, b world.GeoPoint) float64 {
	x := (b.Lng - a.Lng) * math.Pi / 180 * 6371000 * math.Cos((a.Lat+b.Lat)*math.Pi/360)
	y := (b.Lat - a.Lat) * math.Pi / 180 * 6371000
	return math.Hypot(x, y)
}
func closest(origin world.GeoPoint, points []world.GeoPoint) (float64, world.GeoPoint) {
	best := math.Inf(1)
	point := world.GeoPoint{}
	cos := math.Cos(origin.Lat * math.Pi / 180)
	scale := math.Pi / 180 * 6371000
	for i := 1; i < len(points); i++ {
		a, b := points[i-1], points[i]
		ax, ay := (a.Lng-origin.Lng)*scale*cos, (a.Lat-origin.Lat)*scale
		bx, by := (b.Lng-origin.Lng)*scale*cos, (b.Lat-origin.Lat)*scale
		dx, dy := bx-ax, by-ay
		t := 0.0
		if d := dx*dx + dy*dy; d > 0 {
			t = math.Max(0, math.Min(1, -(ax*dx+ay*dy)/d))
		}
		d := math.Hypot(ax+t*dx, ay+t*dy)
		if d < best {
			best = d
			point = world.GeoPoint{Lat: a.Lat + t*(b.Lat-a.Lat), Lng: a.Lng + t*(b.Lng-a.Lng)}
		}
	}
	return best, point
}
func (r *resolver) resolve(input Location) (Resolution, error) {
	result := Resolution{Candidates: []EdgeMatch{}, GraphVersion: r.version, MaxSnapDistanceM: MaxSnapDistanceM}
	if !coordinates(input.Latitude, input.Longitude) || len(input.EdgeIDHint) > 120 {
		return result, ErrInvalid
	}
	if !within(r.bounds, input.Latitude, input.Longitude) {
		result.Message = "La ubicación está fuera del área operativa revisada."
		return result, nil
	}
	for _, road := range r.roads {
		d, p := closest(world.GeoPoint{Lat: input.Latitude, Lng: input.Longitude}, road.points)
		if d <= MaxSnapDistanceM {
			result.Candidates = append(result.Candidates, EdgeMatch{EdgeID: road.id, RoadType: road.kind, DistanceM: d, FromNodeID: road.from, ToNodeID: road.to, Latitude: p.Lat, Longitude: p.Lng})
		}
	}
	sort.Slice(result.Candidates, func(i, j int) bool {
		a, b := result.Candidates[i], result.Candidates[j]
		if a.DistanceM == b.DistanceM {
			return a.EdgeID < b.EdgeID
		}
		return a.DistanceM < b.DistanceM
	})
	if len(result.Candidates) == 0 {
		result.Message = "No hay una calle revisada a menos de 50 metros; ajusta el marcador."
		return result, nil
	}
	if input.EdgeIDHint != "" {
		found := -1
		for i, c := range result.Candidates {
			if c.EdgeID == input.EdgeIDHint {
				found = i
				break
			}
		}
		if found < 0 {
			result.Message = "La calle elegida no está cerca de la ubicación declarada."
			if len(result.Candidates) > 5 {
				result.Candidates = result.Candidates[:5]
			}
			return result, nil
		}
		// A hint chooses only a genuine edge within the strict snap radius. It
		// cannot attach an observation to a remote or invented road.
		choice := result.Candidates[found]
		result.Candidates = append([]EdgeMatch{choice}, append(result.Candidates[:found], result.Candidates[found+1:]...)...)
		result.Matched = true
	} else if len(result.Candidates) > 1 && result.Candidates[1].DistanceM-result.Candidates[0].DistanceM < 5 {
		result.Ambiguous = true
		result.Message = "Hay varias calles próximas; selecciona la calle observada o mueve el marcador."
	} else {
		result.Matched = true
	}
	if result.Matched {
		result.Message = "Calle asociada a la ubicación declarada; esta asociación no verifica la novedad."
	}
	if len(result.Candidates) > 5 {
		result.Candidates = result.Candidates[:5]
	}
	return result, nil
}
