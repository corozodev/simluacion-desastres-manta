import type { Incident } from '@corodev/contracts';

export const incidentTypeLabels: Record<Incident['incident_type'], string> = {
  flooded_road: 'Calle inundada', road_closed: 'Calle cerrada', landslide: 'Deslizamiento',
  fallen_tree: 'Árbol caído', bridge_damage: 'Daño en puente', other: 'Otra novedad',
};
export const incidentStatusLabels: Record<Incident['verification_status'], string> = {
  pending: 'Pendiente de verificación', corroborated: 'Corroborado', verified: 'Verificado',
  rejected: 'Rechazado', expired: 'Caducado',
};
export const incidentSourceLabels: Record<Incident['source_type'], string> = {
  citizen: 'Reporte ciudadano', synthetic: 'Dato sintético de prueba', official: 'Fuente oficial',
};
export const incidentStatusGlyphs: Record<Incident['verification_status'], string> = {
  pending: '?', corroborated: '+', verified: '✓', rejected: '×', expired: '⌛',
};
export function incidentDate(value: string) {
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
}
export function incidentIsExpired(incident: Incident) {
  return incident.verification_status === 'expired' || Date.parse(incident.expires_at) <= Date.now();
}

export type IncidentFilterDraft = {
  type: '' | Incident['incident_type'];
  status: '' | Incident['verification_status'];
  age: '' | '1' | '24' | '168';
};
