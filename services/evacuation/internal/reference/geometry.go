package reference

import (
	"corodev/evacuation/internal/world"
	"fmt"
	"math"
	"strconv"
	"strings"
)

func finite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }
func ValidBBox(b [4]float64) bool {
	for i, v := range b {
		if !finite(v) || v < Manta[i%2] || v > Manta[2+i%2] {
			return false
		}
	}
	return b[0] < b[2] && b[1] < b[3]
}
func ParseBBox(s string) ([4]float64, error) {
	if s == "" {
		return Manta, nil
	}
	b := [4]float64{}
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return b, fmt.Errorf("bbox inválido")
	}
	for i, p := range parts {
		v, e := strconv.ParseFloat(p, 64)
		if e != nil {
			return b, e
		}
		b[i] = v
	}
	if !ValidBBox(b) {
		return b, fmt.Errorf("bbox fuera de la cobertura de Manta")
	}
	return b, nil
}
func bounds(g Geometry) [4]float64 {
	b := [4]float64{180, 90, -180, -90}
	for _, p := range g.Coordinates {
		for _, r := range p {
			for _, v := range r {
				b[0] = math.Min(b[0], v[0])
				b[1] = math.Min(b[1], v[1])
				b[2] = math.Max(b[2], v[0])
				b[3] = math.Max(b[3], v[1])
			}
		}
	}
	return b
}
func intersects(a, b [4]float64) bool {
	return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}
func ValidateGeometry(g Geometry) (int, error) {
	if g.Type != "MultiPolygon" || len(g.Coordinates) == 0 || len(g.Coordinates) > 500 {
		return 0, fmt.Errorf("geometría no soportada")
	}
	count := 0
	for _, p := range g.Coordinates {
		if len(p) == 0 || len(p) > 500 {
			return 0, fmt.Errorf("polígono vacío")
		}
		for _, r := range p {
			if len(r) < 4 || r[0] != r[len(r)-1] {
				return 0, fmt.Errorf("anillo abierto o vacío")
			}
			area := 0.0
			for i, v := range r {
				count++
				if count > 120000 || !finite(v[0]) || !finite(v[1]) || math.Abs(v[0]) > 180 || math.Abs(v[1]) > 90 {
					return 0, fmt.Errorf("coordenadas WGS84 inválidas o demasiados vértices")
				}
				if i > 0 {
					a := r[i-1]
					area += a[0]*v[1] - v[0]*a[1]
				}
			}
			if math.Abs(area) < 1e-14 {
				return 0, fmt.Errorf("anillo degenerado")
			}
		}
	}
	if !intersects(bounds(g), Manta) {
		return 0, fmt.Errorf("geometría fuera de la consulta")
	}
	return count, nil
}
func Filter(c Collection, b [4]float64) Collection {
	c = clone(c)
	features := []Feature{}
	count := 0
	for _, f := range c.Features {
		if intersects(bounds(f.Geometry), b) {
			features = append(features, f)
			n, _ := ValidateGeometry(f.Geometry)
			count += n
		}
	}
	c.Features = features
	c.FeatureCount = len(features)
	c.VertexCount = count
	c.BBox = b
	return c
}
func inside(p Position, r []Position) bool {
	hit := false
	for i, j := 0, len(r)-1; i < len(r); j, i = i, i+1 {
		a, b := r[i], r[j]
		if (a[1] > p[1]) != (b[1] > p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0] {
			hit = !hit
		}
	}
	return hit
}
func segmentDistance(p, a, b Position) float64 {
	scale := 111195.0
	cos := math.Cos(p[1] * math.Pi / 180)
	ax, ay := (a[0]-p[0])*scale*cos, (a[1]-p[1])*scale
	bx, by := (b[0]-p[0])*scale*cos, (b[1]-p[1])*scale
	dx, dy := bx-ax, by-ay
	t := 0.0
	if q := dx*dx + dy*dy; q > 0 {
		t = math.Max(0, math.Min(1, -(ax*dx+ay*dy)/q))
	}
	return math.Hypot(ax+t*dx, ay+t*dy)
}
func circleIntersects(g Geometry, center Position, radius float64) bool {
	for _, polygon := range g.Coordinates {
		in := inside(center, polygon[0])
		for _, hole := range polygon[1:] {
			if inside(center, hole) {
				in = false
			}
		}
		if in {
			return true
		}
		for _, ring := range polygon {
			for i := 1; i < len(ring); i++ {
				if segmentDistance(center, ring[i-1], ring[i]) <= radius {
					return true
				}
			}
		}
	}
	return false
}

// ZoneUse conservatively selects the highest class intersecting the maximum
// artificial footprint, including holes and segment/circle intersections.
// Factors are explicitly dimensionless experiment weights, not physical data.
func ZoneUse(c Collection, id string, center world.GeoPoint, radius, strength float64) world.ReferenceZoneUse {
	result := world.ReferenceZoneUse{ZoneID: id, Susceptibility: "NONE", Factor: 1, FeatureIDs: []string{}}
	rank := map[string]int{"BAJA": 0, "MEDIA": 1, "ALTA": 2}
	best := -1
	box := [4]float64{center.Lng - radius/111195/math.Cos(center.Lat*math.Pi/180), center.Lat - radius/111195, center.Lng + radius/111195/math.Cos(center.Lat*math.Pi/180), center.Lat + radius/111195}
	for _, f := range c.Features {
		if !intersects(bounds(f.Geometry), box) || !circleIntersects(f.Geometry, Position{center.Lng, center.Lat}, radius) {
			continue
		}
		result.FeatureIDs = append(result.FeatureIDs, f.ID)
		if rank[f.Properties.Susceptibility] > best {
			best = rank[f.Properties.Susceptibility]
			result.Susceptibility = f.Properties.Susceptibility
		}
	}
	if best >= 0 {
		result.Factor = 1 + strength*float64(best)
	}
	return result
}
