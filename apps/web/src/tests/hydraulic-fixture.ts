import type { ScenarioSnapshot } from '@corodev/contracts';

export function hydraulicFixture(depths = [0, .05, .2, .6]): NonNullable<ScenarioSnapshot['hydraulic']> {
  return {
    model: 'rainfall_runoff_2d', terrain_source: 'synthetic-test-basin',
    grid: { origin: { lat: -1, lng: -80 }, rows: 2, cols: 2, cell_size_m: 50, lat_step: .0005, lng_step: .0005 },
    depths_m: depths, hydrological_time_seconds: 480, rainfall_mm_h: 96,
    flooded_area_m2: depths.filter(depth => depth >= .01).length * 2500, max_depth_m: Math.max(...depths),
    mass_balance: { initial_storage_m3: depths.reduce((sum, depth) => sum + depth * 2500, 0), rainfall_m3: 0, channel_inflow_m3: 0, sea_inflow_m3: 0, infiltration_m3: 0, drainage_m3: 0, sea_outflow_m3: 0, stored_m3: depths.reduce((sum, depth) => sum + depth * 2500, 0), residual_m3: 0 },
  };
}
