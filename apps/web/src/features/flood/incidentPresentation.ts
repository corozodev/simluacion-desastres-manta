import type { Incident } from '@corodev/contracts';
import type { ModeratedIncident } from '../../services/incidentTypes';

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
export function incidentIsActive(incident: Incident) {
  return !(incident as ModeratedIncident).map_withdrawn && !['rejected', 'expired'].includes(incident.verification_status) && !incidentIsExpired(incident);
}
export function incidentStateLabel(incident: Incident) {
  return (incident as ModeratedIncident).map_withdrawn ? 'Retirado del mapa' : incidentStatusLabels[incident.verification_status];
}
export function incidentOfficialSource(incident: Incident) {
  return (incident as ModeratedIncident).official_source;
}

export type IncidentFilterDraft = {
  type: '' | Incident['incident_type'];
  status: '' | Incident['verification_status'] | 'withdrawn';
  age: '' | '1' | '24' | '168';
};

export const incidentTypeGlyphs: Record<Incident['incident_type'], string> = { flooded_road: '≈', road_closed: '⊘', landslide: '▲', fallen_tree: '♧', bridge_damage: '⌁', other: '!' };
