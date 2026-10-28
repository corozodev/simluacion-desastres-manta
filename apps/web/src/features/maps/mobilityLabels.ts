export const immobilityLabels: Record<string, string> = {
  no_geographic_route: 'Sin conexión geográfica a un refugio',
  blocked_route: 'Sin ruta por cierres',
  visible_threat_route: 'Sin ruta segura por amenazas visibles',
  shelter_full: 'Refugios alcanzables completos',
  wait_with_route: 'Espera con ruta conocida; causa interna no publicada',
  scenario_wait: 'Espera indicada por el escenario',
  aboard: 'A bordo de una camioneta',
  timeout: 'Se agotó el plazo de decisión',
  decision_error: 'Falló la solicitud de decisión',
  invalid_movement: 'Movimiento rechazado por validación',
};

export const vehicleStates: Record<string, string> = { idle: 'Disponible', pickup: 'En recogida', transport: 'En traslado', waiting: 'En espera' };
export const vehicleWaitLabels: Record<string, string> = {
  not_evaluated: 'Asignación aún no evaluada',
  no_active_targets: 'Sin objetivos activos a pie',
  targets_claimed: 'Objetivos asignados a otras camionetas',
  no_safe_pickup_route: 'Sin ruta segura de recogida',
  no_available_safe_shelter: 'Sin refugio con plaza y ruta segura',
  no_useful_pickup: 'Sin recogida con utilidad positiva',
  blocked_movement: 'Tramo bloqueado',
};
