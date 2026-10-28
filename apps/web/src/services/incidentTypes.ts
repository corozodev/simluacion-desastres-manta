import type { Incident, IncidentList, IncidentStatusUpdate } from '@corodev/contracts';

// Presentation helpers for moderation fields declared in OpenAPI.
// Transport declarations are regenerated from packages/contracts/openapi.yaml.
export interface IncidentOfficialSourceInput { title: string; url: string }
export interface IncidentOfficialSource extends IncidentOfficialSourceInput { recorded_at: string }
export type ModeratedIncident = Incident & {
  map_withdrawn?: boolean;
  moderation_note?: string;
  official_source?: IncidentOfficialSource;
};
export type ModeratedIncidentList = Omit<IncidentList, 'incidents'> & { incidents: ModeratedIncident[] };
export type IncidentModerationUpdate = IncidentStatusUpdate & {
  note?: string;
  map_withdrawn?: true;
  official_source?: IncidentOfficialSourceInput;
  official_ack?: boolean;
};
export interface IncidentModerationPermissions {
  can_review: boolean;
  can_withdraw: boolean;
  can_mark_official: boolean;
  operator_login_available: boolean;
}
