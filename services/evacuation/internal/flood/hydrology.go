package flood

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"

	"corodev/evacuation/internal/world"
)

const MaxHydraulicCells = 4096
const RainfallScaleMMH = 120.0

// HydrologyConfig contains scenario assumptions, not measurements. The storm
// clock is independent from evacuation TimeStep and visual playback intervals.
type HydrologyConfig struct {
	SecondsPerTurn      float64 `json:"seconds_per_turn"`
	AntecedentRainHours float64 `json:"antecedent_rain_hours"`
	InitialSaturation   float64 `json:"initial_saturation"`
	InitialWaterDepthM  float64 `json:"initial_water_depth_m"`
	SeaLevelM           float64 `json:"sea_level_m"`
	ChannelInflowM3S    float64 `json:"channel_inflow_m3_s"`
	CellSizeM           float64 `json:"cell_size_m"`
	InfiltrationMMH     float64 `json:"infiltration_mm_h"`
	DrainageMMH         float64 `json:"drainage_mm_h"`
	CautionDepthM       float64 `json:"caution_depth_m"`
	BlockedDepthM       float64 `json:"blocked_depth_m"`
	HysteresisM         float64 `json:"hysteresis_m"`
}

func DefaultHydrologyConfig() HydrologyConfig {
	return HydrologyConfig{SecondsPerTurn: 60, CellSizeM: 200, InfiltrationMMH: 8, DrainageMMH: 6, CautionDepthM: .10, BlockedDepthM: .30, HysteresisM: .03}
}

func (h *HydrologyConfig) UnmarshalJSON(data []byte) error {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return fmt.Errorf("hydrology must be an object")
	}
	type plain HydrologyConfig
	value := plain(DefaultHydrologyConfig())
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(&value); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("hydrology must contain one object")
	}
	*h = HydrologyConfig(value)
	return h.Validate()
}

func (h HydrologyConfig) Validate() error {
	for _, v := range []struct {
		n         string
		v, lo, hi float64
	}{
		{"seconds_per_turn", h.SecondsPerTurn, 1, 300}, {"antecedent_rain_hours", h.AntecedentRainHours, 0, 24},
		{"initial_saturation", h.InitialSaturation, 0, 1}, {"initial_water_depth_m", h.InitialWaterDepthM, 0, 2},
		{"sea_level_m", h.SeaLevelM, -2, 5}, {"channel_inflow_m3_s", h.ChannelInflowM3S, 0, 50},
		{"cell_size_m", h.CellSizeM, 50, 1000}, {"infiltration_mm_h", h.InfiltrationMMH, 0, 100},
		{"drainage_mm_h", h.DrainageMMH, 0, 100}, {"caution_depth_m", h.CautionDepthM, .01, 1},
		{"blocked_depth_m", h.BlockedDepthM, .02, 2}, {"hysteresis_m", h.HysteresisM, 0, 1},
	} {
		if !finite(v.v) || v.v < v.lo || v.v > v.hi {
			return fmt.Errorf("invalid hydrology.%s", v.n)
		}
	}
	if h.BlockedDepthM <= h.CautionDepthM || h.HysteresisM >= h.CautionDepthM {
		return fmt.Errorf("invalid hydraulic depth thresholds")
	}
	return nil
}

type hydraulicLink struct{ a, b int }

// hydraulicDomain uses a four-neighbour finite-volume stencil. Links can be
// removed to represent impermeable barriers; omitted boundaries are no-flow.
// All work arrays are allocated once, independently of simulation length.
type hydraulicDomain struct {
	grid                                      world.HydraulicGrid
	cfg                                       HydrologyConfig
	elevation, depth, saturation, rainWeights []float64
	links                                     []hydraulicLink
	outfalls                                  []int
	channelCell                               int
	flux, seaFlux, outgoing, delta            []float64
	ledger                                    world.HydraulicMassBalance
	clock                                     float64
	rainfall                                  float64
}

func newDomain(grid world.HydraulicGrid, elevation []float64, links []hydraulicLink, outfalls []int, cfg HydrologyConfig) *hydraulicDomain {
	n := len(elevation)
	d := &hydraulicDomain{grid: grid, cfg: cfg, elevation: append([]float64{}, elevation...), links: append([]hydraulicLink{}, links...), outfalls: append([]int{}, outfalls...), channelCell: n - 1,
		depth: make([]float64, n), saturation: make([]float64, n), rainWeights: make([]float64, n), flux: make([]float64, len(links)), seaFlux: make([]float64, len(outfalls)), outgoing: make([]float64, n), delta: make([]float64, n)}
	for i := range d.depth {
		d.depth[i] = cfg.InitialWaterDepthM
		d.saturation[i] = cfg.InitialSaturation
		d.rainWeights[i] = 1
	}
	d.ledger.InitialStorageM3 = cfg.InitialWaterDepthM * grid.CellSizeM * grid.CellSizeM * float64(n)
	return d
}

func regularLinks(rows, cols int) []hydraulicLink {
	links := make([]hydraulicLink, 0, rows*(cols-1)+cols*(rows-1))
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			i := r*cols + c
			if c+1 < cols {
				links = append(links, hydraulicLink{i, i + 1})
			}
			if r+1 < rows {
				links = append(links, hydraulicLink{i, i + cols})
			}
		}
	}
	return links
}

// buildDomain is deterministic preprocessing over the checked-in street extent,
// expanded one cell on every side. Terrain is an explicitly synthetic westward
// basin with a central channel and local depressions, not an inferred Manta DEM.
// The west boundary is an experimental outfall, not a mapped coastline.
func buildDomain(g *world.Graph, cfg HydrologyConfig) *hydraulicDomain {
	minLat, minLng, maxLat, maxLng := g.Nodes[0].Lat, g.Nodes[0].Lng, g.Nodes[0].Lat, g.Nodes[0].Lng
	include := func(p world.GeoPoint) {
		minLat = math.Min(minLat, p.Lat)
		maxLat = math.Max(maxLat, p.Lat)
		minLng = math.Min(minLng, p.Lng)
		maxLng = math.Max(maxLng, p.Lng)
	}
	for _, n := range g.Nodes {
		include(world.GeoPoint{Lat: n.Lat, Lng: n.Lng})
	}
	for _, e := range g.Edges {
		for _, p := range e.Geometry {
			include(p)
		}
	}
	metresLat := 6371000 * math.Pi / 180
	metresLng := metresLat * math.Cos((minLat+maxLat)*.5*math.Pi/180)
	width, height := (maxLng-minLng)*metresLng, (maxLat-minLat)*metresLat
	cell := cfg.CellSizeM
	cols, rows := int(math.Ceil(width/cell))+2, int(math.Ceil(height/cell))+2
	for rows*cols > MaxHydraulicCells {
		cell *= 1.05
		cols = int(math.Ceil(width/cell)) + 2
		rows = int(math.Ceil(height/cell)) + 2
	}
	grid := world.HydraulicGrid{Origin: world.GeoPoint{Lat: minLat - cell/metresLat, Lng: minLng - cell/metresLng}, Rows: rows, Cols: cols, CellSizeM: cell, LatStep: cell / metresLat, LngStep: cell / metresLng}
	elevation := make([]float64, rows*cols)
	outfalls := make([]int, 0, rows)
	for r := 0; r < rows; r++ {
		outfalls = append(outfalls, r*cols)
		for c := 0; c < cols; c++ {
			x, y := (float64(c)+.5)*cell, (float64(r)+.5)*cell
			mid := float64(rows) * cell * .5
			// Gradual lateral slope feeds a shallow channel running to the outlet.
			channel := .9 * math.Exp(-math.Pow((y-mid)/(2*cell), 2))
			depression := .7 * math.Exp(-math.Pow((x-float64(cols)*cell*.55)/(2*cell), 2)-math.Pow((y-mid-cell)/(2*cell), 2))
			elevation[r*cols+c] = math.Max(.02, .001*x+.00015*math.Abs(y-mid)-channel-depression)
		}
	}
	d := newDomain(grid, elevation, regularLinks(rows, cols), outfalls, cfg)
	d.channelCell = (rows/2)*cols + cols - 1
	// A fixed distributed rain field with exact domain mean one. It is independent
	// of road-node density and never changes when candidate shelters are edited.
	mean := 0.0
	for i := range d.rainWeights {
		r, c := i/cols, i%cols
		d.rainWeights[i] = 1 + .15*math.Sin(float64(r)*.43)*math.Cos(float64(c)*.31)
		mean += d.rainWeights[i]
	}
	mean /= float64(len(d.rainWeights))
	for i := range d.rainWeights {
		d.rainWeights[i] /= mean
	}
	return d
}

// transport is a Manning-style diffusive-wave approximation, without momentum
// or pressure dynamics. Transfer is capped by local head equalisation and later
// by total donor availability; dry barriers cannot create or teleport water.
func (d *hydraulicDomain) transport(headDifference, upstreamDepth, dt float64) float64 {
	if headDifference <= 0 || upstreamDepth <= 0 {
		return 0
	}
	cell := d.grid.CellSizeM
	q := cell / .06 * math.Pow(upstreamDepth, 5.0/3) * math.Sqrt(headDifference/cell)
	return math.Min(q*dt, headDifference*cell*cell*.25)
}

func (d *hydraulicDomain) substep(dt, rainfallMMH float64) {
	area := d.grid.CellSizeM * d.grid.CellSizeM
	d.rainfall = rainfallMMH
	for i := range d.depth {
		added := rainfallMMH * dt / 3600000 * d.rainWeights[i]
		d.depth[i] += added
		d.ledger.RainfallM3 += added * area
	}
	if d.cfg.ChannelInflowM3S > 0 {
		v := d.cfg.ChannelInflowM3S * dt
		d.depth[d.channelCell] += v / area
		d.ledger.ChannelInflowM3 += v
	}
	for i := range d.depth {
		inf := math.Min(d.depth[i], d.cfg.InfiltrationMMH*(1-d.saturation[i])*dt/3600000)
		d.depth[i] -= inf
		d.ledger.InfiltrationM3 += inf * area
		// 100 mm of effective soil storage is an uncalibrated urban-soil assumption.
		d.saturation[i] = math.Min(1, d.saturation[i]+inf/.1)
		head := d.elevation[i] + d.depth[i]
		// Synthetic pipes discharge to the same sea datum. Backwater reduces capacity;
		// they do not provide an unbounded pump when the outlet is submerged.
		capacity := d.cfg.DrainageMMH * clamp((head-d.cfg.SeaLevelM)/.5) * dt / 3600000
		drain := math.Min(d.depth[i], capacity)
		d.depth[i] -= drain
		d.ledger.DrainageM3 += drain * area
		d.outgoing[i] = 0
		d.delta[i] = 0
	}
	for j, link := range d.links {
		a, b := link.a, link.b
		diff := d.elevation[a] + d.depth[a] - d.elevation[b] - d.depth[b]
		f := 0.0
		if diff > 0 {
			f = d.transport(diff, d.depth[a], dt)
			d.outgoing[a] += f
		} else {
			f = -d.transport(-diff, d.depth[b], dt)
			d.outgoing[b] -= f
		}
		d.flux[j] = f
	}
	for j, i := range d.outfalls {
		diff := d.elevation[i] + d.depth[i] - d.cfg.SeaLevelM
		f := 0.0
		if diff > 0 {
			f = d.transport(diff, d.depth[i], dt)
			d.outgoing[i] += f
		} else {
			// Sea enters only through explicitly connected outfalls. High sea level
			// without a connection cannot wet a cell.
			f = -d.transport(-diff, math.Max(0, d.cfg.SeaLevelM-d.elevation[i]), dt)
		}
		d.seaFlux[j] = f
	}
	scale := func(i int) float64 {
		if d.outgoing[i] > 0 {
			return math.Min(1, d.depth[i]*area/d.outgoing[i])
		}
		return 1
	}
	for j, link := range d.links {
		f := d.flux[j]
		if f > 0 {
			f *= scale(link.a)
		} else {
			f *= scale(link.b)
		}
		d.delta[link.a] -= f
		d.delta[link.b] += f
	}
	for j, i := range d.outfalls {
		f := d.seaFlux[j]
		if f > 0 {
			f *= scale(i)
			d.ledger.SeaOutflowM3 += f
		} else {
			d.ledger.SeaInflowM3 -= f
		}
		d.delta[i] -= f
	}
	for i := range d.depth {
		d.depth[i] = math.Max(0, d.depth[i]+d.delta[i]/area)
	}
	d.clock += dt
}

func (d *hydraulicDomain) advance(seconds, rainfallMMH float64) {
	// At most thirty physical seconds; the flux limiter also prevents negative
	// depths on unusually steep or shallow cells at any allowed resolution.
	for seconds > 0 {
		dt := math.Min(seconds, math.Min(30, d.grid.CellSizeM/5))
		d.substep(dt, rainfallMMH)
		seconds -= dt
	}
}

func (d *hydraulicDomain) budget() world.HydraulicMassBalance {
	b := d.ledger
	area := d.grid.CellSizeM * d.grid.CellSizeM
	for _, depth := range d.depth {
		b.StoredM3 += depth * area
	}
	b.ResidualM3 = b.InitialStorageM3 + b.RainfallM3 + b.ChannelInflowM3 + b.SeaInflowM3 - b.InfiltrationM3 - b.DrainageM3 - b.SeaOutflowM3 - b.StoredM3
	return b
}

func (d *hydraulicDomain) cellAt(p world.GeoPoint) int {
	row, col := int(math.Floor((p.Lat-d.grid.Origin.Lat)/d.grid.LatStep)), int(math.Floor((p.Lng-d.grid.Origin.Lng)/d.grid.LngStep))
	if row < 0 || col < 0 || row >= d.grid.Rows || col >= d.grid.Cols {
		return -1
	}
	return row*d.grid.Cols + col
}
