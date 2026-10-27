package floodlab

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"corodev/evacuation/internal/graph"
	"corodev/evacuation/internal/world"
)

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func validCandidateFields(c Candidate) bool {
	return strings.TrimSpace(c.ID) != "" && len(c.ID) <= 64 && strings.TrimSpace(c.Label) != "" && len(c.Label) <= 120 && finite(c.Lat) && finite(c.Lng) && math.Abs(c.Lat) <= 90 && math.Abs(c.Lng) <= 180 && c.Capacity >= 1 && c.Capacity <= 200
}

func distanceM(a, b world.GeoPoint) float64 {
	const radians = math.Pi / 180
	x := (b.Lng - a.Lng) * radians * math.Cos((a.Lat+b.Lat)*radians/2)
	y := (b.Lat - a.Lat) * radians
	return math.Hypot(x, y) * 6371000
}

// nearest considers only nodes incident to a passable baseline street. Ties use
// the node ID rather than input slice order, preserving deterministic snapping.
func nearest(g *world.Graph, p world.GeoPoint) (world.GraphNode, float64) {
	legal := map[string]bool{}
	for _, e := range g.Edges {
		if !e.Blocked {
			legal[e.From], legal[e.To] = true, true
		}
	}
	var best world.GraphNode
	distance := math.Inf(1)
	for _, n := range g.Nodes {
		if !legal[n.ID] {
			continue
		}
		d := distanceM(p, world.GeoPoint{Lat: n.Lat, Lng: n.Lng})
		if d < distance || (d == distance && n.ID < best.ID) {
			best, distance = n, d
		}
	}
	return best, distance
}

func reachableFromEveryNode(g *world.Graph, target string) bool {
	reverse := map[string][]string{}
	for _, e := range g.Edges {
		if e.Blocked {
			continue
		}
		reverse[e.To] = append(reverse[e.To], e.From)
		if !e.Directed {
			reverse[e.From] = append(reverse[e.From], e.To)
		}
	}
	seen, queue := map[string]bool{target: true}, []string{target}
	for head := 0; head < len(queue); head++ {
		for _, previous := range reverse[queue[head]] {
			if !seen[previous] {
				seen[previous] = true
				queue = append(queue, previous)
			}
		}
	}
	return len(seen) == len(g.Nodes)
}

func validateCandidates(g *world.Graph, candidates []Candidate) CandidateValidation {
	result := CandidateValidation{Valid: len(candidates) == 4, Candidates: []ValidatedCandidate{}}
	ids, nodes := map[string]bool{}, map[string]bool{}
	for _, c := range candidates {
		v := ValidatedCandidate{Candidate: c, Valid: true, Message: "Candidato de laboratorio ajustado a una intersección accesible."}
		if !validCandidateFields(c) {
			v.Valid, v.Message = false, "Revisa nombre, coordenadas y capacidad experimental."
		} else {
			node, d := nearest(g, world.GeoPoint{Lat: c.Lat, Lng: c.Lng})
			v.NodeID, v.SnappedLat, v.SnappedLng = node.ID, node.Lat, node.Lng
			if finite(d) {
				v.SnapDistanceM = d
			}
			switch {
			case node.ID == "" || !finite(d) || d > MaxSnapDistanceM:
				v.Valid, v.Message = false, "No hay una intersección transitable a 500 m o menos."
			case ids[c.ID] || nodes[node.ID]:
				v.Valid, v.Message = false, "El identificador o la intersección ya pertenece a otro candidato."
			case !reachableFromEveryNode(g, node.ID):
				v.Valid, v.Message = false, "La dirección de las calles deja este candidato inaccesible desde parte del grafo."
			}
			ids[c.ID], nodes[node.ID] = true, true
		}
		if len(candidates) != 4 {
			v.Valid, v.Message = false, "Selecciona exactamente cuatro candidatos antes de iniciar."
		}
		result.Valid = result.Valid && v.Valid
		result.Candidates = append(result.Candidates, v)
	}
	return result
}

func candidateGraph(g *world.Graph, candidates []Candidate) (*world.Graph, CandidateValidation, error) {
	validation := validateCandidates(g, candidates)
	if !validation.Valid {
		return nil, validation, fmt.Errorf("los cuatro candidatos no superaron la validación vial")
	}
	result := g.Clone()
	result.Shelters = []world.Shelter{}
	for _, c := range validation.Candidates {
		result.Shelters = append(result.Shelters, world.Shelter{ID: c.ID, NodeID: c.NodeID, Capacity: c.Capacity, Available: c.Capacity})
	}
	if err := graph.Validate(result); err != nil {
		return nil, validation, fmt.Errorf("los candidatos no forman un conjunto vial válido")
	}
	// Identity includes the candidate setup, so a client cannot reuse geography
	// containing another run's shelters merely because the roads are unchanged.
	result.Version += "-lab-" + digest(candidates)[:12]
	return result, validation, nil
}

func originalCandidates(g *world.Graph) []Candidate {
	nodes := map[string]world.GraphNode{}
	for _, n := range g.Nodes {
		nodes[n.ID] = n
	}
	result := []Candidate{}
	for _, sh := range g.Shelters {
		n := nodes[sh.NodeID]
		result = append(result, Candidate{ID: sh.ID, Label: "Candidato original " + sh.ID, Lat: n.Lat, Lng: n.Lng, Capacity: sh.Capacity})
	}
	return result
}

func digest(value any) string {
	raw, _ := json.Marshal(value)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

func originsHash(origins []Origin) string {
	// Source coordinates and agent identity stay the same across graph modes;
	// selected node IDs and snap distances remain visible separately.
	type source struct {
		ID       string
		Lat, Lng float64
	}
	items := []source{}
	for _, o := range origins {
		items = append(items, source{o.ID, o.Lat, o.Lng})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return digest(items)
}
