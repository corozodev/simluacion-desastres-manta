import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, MessageSquare, ShieldCheck } from 'lucide-react';
import type { Incident, IncidentApplyResult, IncidentList, IncidentStatusUpdate, LabState } from '@corodev/contracts';
import { Badge, Button, Card, ErrorState, LoadingState } from '../../components/ui';
import { api } from '../../services/api';
import { incidentDate, incidentIsExpired, incidentSourceLabels, incidentStatusGlyphs, incidentStatusLabels, incidentTypeLabels, type IncidentFilterDraft } from './incidentPresentation';

export interface IncidentPanelProps {
  list?: IncidentList;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  filters: IncidentFilterDraft;
  onFilters: (filters: IncidentFilterDraft) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  selected?: Incident;
  detailLoading?: boolean;
  detailError?: Error | null;
  backend: LabState;
  preview: boolean;
  csrf: string;
  busy: boolean;
  onApplied: (result: IncidentApplyResult) => void;
}

export function IncidentPanel({ list, loading, error, onRetry, filters, onFilters, selectedId, onSelect, selected, detailLoading, detailError, backend, preview, csrf, busy, onApplied }: IncidentPanelProps) {
  const client = useQueryClient();
  const [preparing, setPreparing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [duration, setDuration] = useState(20);
  const [effect, setEffect] = useState<'blocked' | 'caution'>('blocked');
  const [reviewStatus, setReviewStatus] = useState<IncidentStatusUpdate['verification_status']>('pending');
  const [receipt, setReceipt] = useState<IncidentApplyResult>();
  const refresh = () => { void client.invalidateQueries({ queryKey: ['incidents'] }); };
  const apply = useMutation({
    mutationFn: () => api.applyFloodIncident(selected!.incident_id, backend.run_id, csrf, duration, effect),
    onSuccess: result => { setReceipt(result); setPreparing(false); setAcknowledged(false); onApplied(result); refresh(); },
    onError: refresh,
  });
  const review = useMutation({
    mutationFn: () => api.reviewIncident(selected!.incident_id, { verification_status: reviewStatus, expected_updated_at: selected!.updated_at }, csrf),
    onSuccess: refresh, onError: refresh,
  });
  useEffect(() => { setPreparing(false); setAcknowledged(false); setReceipt(undefined); apply.reset(); review.reset(); }, [selectedId, backend.run_id]);
  useEffect(() => { if (selected && selected.verification_status !== 'expired') setReviewStatus(selected.verification_status); }, [selected?.incident_id, selected?.verification_status]);
  const authorized = Boolean(csrf);
  const validRun = !preview && ['running', 'paused'].includes(backend.state) && backend.comparison?.state !== 'running';
  const expired = selected ? incidentIsExpired(selected) : false;
  const eligible = Boolean(selected && !expired && selected.verification_status !== 'rejected' && selected.affected_edge_ids.length);
  const disabled = busy || apply.isPending || review.isPending || !authorized || !validRun || !eligible;
  const application = selected ? backend.incident_applications?.find(item => item.incident_id === selected.incident_id) : undefined;
  const currentReceipt = receipt?.application.run_id === backend.run_id ? receipt : undefined;
  return <Card className="flood-incidents-card" aria-label="Novedades georreferenciadas">
    <div className="flood-card-heading"><div><span className="flood-kicker"><MessageSquare size={16} /> NOVEDADES GEOREFERENCIADAS</span><h2>Reportes y procedencia</h2><p>Las ubicaciones son aproximadas. Un reporte ciudadano pendiente no confirma una condición vial ni recomienda una ruta de emergencia.</p></div><Badge tone="warning">{list?.total ?? 0} reportes encontrados</Badge></div>
    <div className="flood-incident-filters"><label>Tipo de novedad<select aria-label="Tipo de novedad" value={filters.type} onChange={event => onFilters({ ...filters, type: event.target.value as IncidentFilterDraft['type'] })}><option value="">Todos los tipos</option>{Object.entries(incidentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Estado de verificación<select aria-label="Estado de verificación" value={filters.status} onChange={event => onFilters({ ...filters, status: event.target.value as IncidentFilterDraft['status'] })}><option value="">Reportes activos</option>{Object.entries(incidentStatusLabels).filter(([status]) => authorized || !['rejected', 'expired'].includes(status)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Antigüedad del reporte<select aria-label="Antigüedad del reporte" value={filters.age} onChange={event => onFilters({ ...filters, age: event.target.value as IncidentFilterDraft['age'] })}><option value="1">Última hora</option><option value="24">Últimas 24 horas</option><option value="168">Últimos 7 días</option><option value="">Todas las fechas</option></select></label>
    </div>
    <p className="muted">Actualización cada 5 segundos en la cobertura mostrada. La fecha del filtro corresponde a la recepción del servidor.</p>
    {loading ? <LoadingState label="Consultando novedades de esta cobertura…" /> : error ? <ErrorState error={error} onRetry={onRetry} /> : <div className="flood-incident-columns"><div className="flood-incident-list" aria-label="Lista de novedades">{list?.incidents.length ? list.incidents.map(incident => <button key={incident.incident_id} type="button" aria-label={`Seleccionar incidente ${incident.incident_id}`} aria-pressed={selectedId === incident.incident_id} className={`flood-incident-item flood-incident-${incident.verification_status}`} onClick={() => onSelect(incident.incident_id)}><span className="flood-incident-glyph" aria-hidden="true">{incidentStatusGlyphs[incident.verification_status]}</span><span><strong>{incidentTypeLabels[incident.incident_type]}</strong><span>{incidentStatusLabels[incident.verification_status]}</span><span className={incident.source_type === 'synthetic' ? 'flood-incident-synthetic-label' : ''}>{incidentSourceLabels[incident.source_type]}</span><small>Recibido {incidentDate(incident.received_at)}</small></span></button>) : <p className="flood-incident-empty" role="status">No hay novedades con estos filtros en la cobertura mostrada.</p>}{list?.has_more && <p className="muted" role="status">Se muestran hasta {list.limit} reportes. Acota el tipo, estado o antigüedad para consultar los restantes.</p>}</div>
      <div className="flood-incident-detail-area">{detailLoading ? <LoadingState label="Consultando detalle del reporte…" /> : detailError ? <ErrorState error={detailError} onRetry={onRetry} /> : selected ? <section className="flood-incident-detail" aria-label={`Detalle de incidente ${selected.incident_id}`}>
        <div className="flood-incident-detail-heading"><MapPin size={18} /><h3>{incidentTypeLabels[selected.incident_type]}</h3></div><p className={`flood-incident-state flood-incident-${selected.verification_status}`}>{incidentSourceLabels[selected.source_type]} · {incidentStatusLabels[selected.verification_status]}</p>{selected.source_type === 'citizen' && selected.verification_status === 'pending' && <p className="flood-incident-notice">Reporte ciudadano pendiente de verificación</p>}{selected.source_type === 'synthetic' && <p className="flood-incident-notice">Dato sintético para pruebas; no describe una observación real.</p>}
        <p className="flood-incident-description">{selected.description}</p><dl className="flood-incident-metadata"><div><dt>Ubicación aproximada</dt><dd>{selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)} · cuantización de {selected.location_precision_m} m; no mide la exactitud del dispositivo</dd></div><div><dt>Momento declarado</dt><dd>{incidentDate(selected.event_time)}</dd></div><div><dt>Recibido por el servidor</dt><dd>{incidentDate(selected.received_at)}</dd></div><div><dt>Última actualización</dt><dd>{incidentDate(selected.updated_at)}</dd></div><div><dt>Caduca</dt><dd>{incidentDate(selected.expires_at)}{expired && ' · Caducado'}</dd></div><div><dt>Transitabilidad declarada</dt><dd>{{ passable: 'Transitable', restricted: 'Restringida', blocked: 'Bloqueada', unknown: 'Desconocida' }[selected.road_passability_reported]}</dd></div><div><dt>Severidad declarada</dt><dd>{{ low: 'Baja', moderate: 'Moderada', high: 'Alta', unknown: 'Desconocida' }[selected.severity_reported]}</dd></div><div><dt>Aristas asociadas</dt><dd>{selected.affected_edge_ids.join(', ') || 'Sin asociación vial admisible'}</dd></div><div><dt>Identificador del reporte</dt><dd>{selected.incident_id}</dd></div></dl>
        <details className="flood-incident-application"><summary>Evaluación experimental en esta ejecución</summary><p>Acción autorizada: aplica un efecto temporal sólo a la ejecución actual; conserva la procedencia del reporte.</p>{!validRun && <p className="muted">Inicia o pausa una tormenta en la cobertura activa para evaluar el reporte; espera a que termine cualquier comparación A/B.</p>}{!authorized && <p className="muted">La aplicación requiere la sesión local autorizada del laboratorio.</p>}{!eligible && <p className="muted">No se aplican reportes rechazados, caducados ni sin asociación vial.</p>}
          {!preparing ? <Button variant="secondary" disabled={disabled} onClick={() => { setPreparing(true); setAcknowledged(false); apply.reset(); }}>Revisar aplicación experimental</Button> : <div className="flood-incident-apply-review"><p>Reporte {selected.incident_id} → ejecución {backend.run_id}. Aristas: {selected.affected_edge_ids.join(', ')}.</p><label>Efecto experimental<select aria-label="Efecto experimental" value={effect} onChange={event => setEffect(event.target.value as 'blocked' | 'caution')}><option value="blocked">Cierre temporal</option><option value="caution">Precaución temporal</option></select></label><label>Duración del overlay en pasos<input type="number" min="1" max="1000" step="1" value={duration} onChange={event => setDuration(Number(event.target.value))} /></label><label className="flood-incident-ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />Entiendo que esta evaluación es experimental y no confirma el reporte ni habilita navegación real.</label><div className="flood-actions"><Button disabled={disabled || !acknowledged || !Number.isInteger(duration) || duration < 1 || duration > 1000} onClick={() => apply.mutate()}>{apply.isPending ? 'Aplicando…' : 'Aplicar incidente a simulación'}</Button><Button variant="ghost" disabled={apply.isPending} onClick={() => setPreparing(false)}>Cancelar</Button></div></div>}
          {apply.error && <ErrorState error={apply.error} onRetry={() => apply.reset()} />}{currentReceipt && <p className="flood-validation-success" role="status">{currentReceipt.already_applied ? 'El incidente ya estaba aplicado; no se duplicó el overlay.' : 'Incidente aplicado a esta ejecución experimental.'} El reporte continúa {incidentStatusLabels[currentReceipt.incident.verification_status].toLowerCase()}.</p>}
          {application && <dl className="flood-incident-audit" aria-label="Registro de aplicación experimental"><div><dt>Ejecución</dt><dd>{application.run_id}</dd></div><div><dt>Paso / versión del mundo</dt><dd>{application.simulation_step} / {application.world_version}</dd></div><div><dt>Efecto y caducidad simulada</dt><dd>{application.effect === 'blocked' ? 'Cierre temporal' : 'Precaución temporal'} · hasta el paso {application.expires_at_simulation_step}</dd></div><div><dt>Procedencia al aplicar</dt><dd>{incidentSourceLabels[application.source_type]} · {incidentStatusLabels[application.verification_status_at_application]}</dd></div><div><dt>Aristas del overlay</dt><dd>{application.affected_edge_ids.join(', ')}</dd></div></dl>}
        </details>
        {authorized && !expired && <details className="flood-incident-moderation"><summary><ShieldCheck size={14} />Revisión autorizada del reporte</summary><p>Esta revisión modifica el estado del reporte, conserva su procedencia y no lo aplica al motor.</p><label>Nuevo estado de verificación<select aria-label="Nuevo estado de verificación" value={reviewStatus} onChange={event => setReviewStatus(event.target.value as IncidentStatusUpdate['verification_status'])}>{Object.entries(incidentStatusLabels).filter(([status]) => status !== 'expired').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button variant="secondary" disabled={busy || review.isPending || apply.isPending || reviewStatus === selected.verification_status} onClick={() => review.mutate()}>{review.isPending ? 'Guardando revisión…' : 'Guardar revisión autorizada'}</Button>{review.error && <ErrorState error={review.error} onRetry={() => review.reset()} />}{review.isSuccess && <p role="status">Revisión guardada. La procedencia del reporte se conserva.</p>}</details>}
      </section> : <p className="flood-incident-empty">Selecciona un marcador o un reporte para consultar su procedencia y evaluar su aplicación al laboratorio.</p>}</div>
    </div>}
  </Card>;
}
