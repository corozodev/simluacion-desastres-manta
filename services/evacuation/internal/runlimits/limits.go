// Package runlimits centralizes the public experimental simulation horizons.
package runlimits

const (
	MinTicks      = 30
	MaxTicks      = 3000
	DefaultTicks  = 150
	OfficialTicks = 150
)

type DurationLimits struct {
	MinTicks     int `json:"min_ticks"`
	MaxTicks     int `json:"max_ticks"`
	DefaultTicks int `json:"default_ticks"`
}

func Duration() DurationLimits {
	return DurationLimits{MinTicks: MinTicks, MaxTicks: MaxTicks, DefaultTicks: DefaultTicks}
}
