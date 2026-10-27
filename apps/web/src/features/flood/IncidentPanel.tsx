import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, MessageSquare, ShieldCheck } from 'lucide-react';
import type { Incident, IncidentApplyResult, IncidentList, LabState } from '@corodev/contracts';
import type { IncidentModerationPermissions, IncidentModerationUpdate, ModeratedIncident } from '../../services/incidentTypes';
import { Badge, Button, Card, ErrorState, LoadingState } from '../../components/ui';
import { api, reconcileIncidentList, type IncidentFilters } from '../../services/api';
import { incidentDate, incidentIsExpired, incidentOfficialSource, incidentSourceLabels, incidentStateLabel, incidentStatusLabels, incidentTypeLabels, type IncidentFilterDraft } from './incidentPresentation';

export interface IncidentPanelProps {
  list?: IncidentList;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  filters: IncidentFilterDraft;
  onFilters: (filters: IncidentFilterDraft) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  onLocate?: (id: string) => void;
  selected?: Incident;
  detailLoading?: boolean;
  detailError?: Error | null;
  csrf: string;
  permissions?: IncidentModerationPermissions;
  access?: ReactNode;
  busy?: boolean;
  // Existing embedding callers may still provide these; moderation never reads
  // or mutates a simulation, and the experimental application UI is removed.
  backend?: LabState;
  preview?: boolean;
  onApplied?: (result: IncidentApplyResult) => void;
}

type ReviewAction = 'verify' | 'reject' | 'withdraw' | 'official';
const severityLabels = { low: 'Baja', moderate: 'Moderada', high: 'Alta', unknown: 'Sin especificar' };

export function IncidentPanel({ list, loading, error, onRetry, filters, onFilters, selectedId, onSelect, onLocate, selected, detailLoading, detailError, csrf, permissions, access, busy = false }: IncidentPanelProps) {
  const client = useQueryClient();
  const [form, setForm] = useState<ReviewAction>();
  const [note, setNote] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceURL, setSourceURL] = useState('');
  const [sourceAck, setSourceAck] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const saving = useRef(false);
  const selection = useRef(selectedId);
  selection.current = selectedId;
  const refresh = () => { void client.invalidateQueries({ queryKey: ['incidents', 'list'] }); void client.invalidateQueries({ queryKey: ['incidents', 'detail'] }); void client.invalidateQueries({ queryKey: ['mobile', 'incidents'] }); };
  const review = useMutation({
    mutationFn: (input: { id: string; update: IncidentModerationUpdate }) => api.reviewIncident(input.id, input.update, csrf),
    onMutate: async () => { await client.cancelQueries({ queryKey: ['incidents', 'list'] }); await client.cancelQueries({ queryKey: ['incidents', 'detail'] }); await client.cancelQueries({ queryKey: ['mobile', 'incidents'] }); },
    onSuccess: async result => {
      await client.cancelQueries({ queryKey: ['incidents', 'list'] });
      await client.cancelQueries({ queryKey: ['incidents', 'detail'] }); await client.cancelQueries({ queryKey: ['mobile', 'incidents'] });
      client.setQueryData(['incidents', 'detail', result.incident_id], result);
      for (const [key, value] of [...client.getQueriesData<IncidentList>({ queryKey: ['incidents', 'list'] }), ...client.getQueriesData<IncidentList>({ queryKey: ['mobile', 'incidents'] })]) {
        if (!value) continue;
        const updated = { ...value, incidents: value.incidents.map(item => item.incident_id === result.incident_id ? result : item) };
        client.setQueryData(key, reconcileIncidentList(updated, key[2] as IncidentFilters));
      }
      if (selection.current === result.incident_id) {
        setConfirmation('Revisión guardada. El mapa se actualizó con la respuesta del servidor.');
        setForm(undefined); setNote(''); setSourceAck(false);
      }
      refresh();
    },
    onError: () => { setConfirmation(''); refresh(); },
  });
  useEffect(() => { setForm(undefined); setNote(''); setSourceTitle(''); setSourceURL(''); setSourceAck(false); setConfirmation(''); review.reset(); }, [selectedId]);
  const report = selected as ModeratedIncident | undefined;
  const withdrawn = Boolean(report?.map_withdrawn);
  const inactive = !report || withdrawn || incidentIsExpired(report);
  const authorized = Boolean(csrf && permissions?.can_review);
  const source = report && incidentOfficialSource(report);
  const disabled = busy || review.isPending || !authorized || inactive;
  const submit = (action: ReviewAction) => {
    if (!report || disabled || saving.current) return;
    if (action === 'withdraw' && !permissions?.can_withdraw || action === 'official' && !permissions?.can_mark_official) return;
    if (action === 'reject' && !note.trim() || action === 'official' && (!sourceAck || sourceTitle.trim().length < 3 || !/^https:\/\//i.test(sourceURL))) return;
    const update: IncidentModerationUpdate = {
      verification_status: action === 'reject' ? 'rejected' : action === 'withdraw' ? report.verification_status === 'expired' ? 'rejected' : report.verification_status : 'verified',
      expected_updated_at: report.updated_at,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(action === 'withdraw' ? { map_withdrawn: true as const } : {}),
      ...(action === 'official' ? { official_source: { title: sourceTitle.trim(), url: sourceURL.trim() }, official_ack: true } : {}),
    };
    saving.current = true;
    void review.mutateAsync({ id: report.incident_id, update }).catch(() => {}).finally(() => { saving.current = false; });
  };
  return <Card className="flood-incidents-card" aria-label="Novedades georreferenciadas">
    <div className="flood-card-heading"><div><span className="flood-kicker"><MessageSquare size={15} /> NOVEDADES</span><h2>Consulta y moderación</h2></div><Badge tone="neutral">{list?.total ?? 0} reportes</Badge></div>
    <div className="flood-incident-filters">
      <label>Tipo<select aria-label="Tipo de novedad" value={filters.type} onChange={event => onFilters({ ...filters, type: event.target.value as IncidentFilterDraft['type'] })}><option value="">Todos</option>{Object.entries(incidentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Estado<select aria-label="Estado de verificación" value={filters.status} onChange={event => onFilters({ ...filters, status: event.target.value as IncidentFilterDraft['status'] })}><option value="">Activos</option>{Object.entries(incidentStatusLabels).filter(([status]) => authorized || !['rejected', 'expired'].includes(status)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}{authorized && <option value="withdrawn">Retirados del mapa</option>}</select></label>
      <label>Recientes<select aria-label="Antigüedad del reporte" value={filters.age} onChange={event => onFilters({ ...filters, age: event.target.value as IncidentFilterDraft['age'] })}><option value="1">Última hora</option><option value="24">Último día</option><option value="168">Última semana</option><option value="">Todos</option></select></label>
    </div>
    {error && <ErrorState error={error} onRetry={onRetry} />}
    {loading && !list ? <LoadingState label="Cargando reportes…" /> : <div className={`flood-incident-workspace ${report ? 'has-selection' : ''}`}>
      <div className="flood-incident-list" aria-label="Lista de reportes">
        {!list?.incidents.length && <p className="flood-incident-empty">No hay reportes con estos filtros.</p>}
        {list?.incidents.map(item => <button type="button" key={item.incident_id} className={`flood-incident-card ${selectedId === item.incident_id ? 'selected' : ''}`} aria-pressed={selectedId === item.incident_id} onClick={() => { onSelect(item.incident_id); onLocate?.(item.incident_id); }}>
          <span className="flood-incident-card-heading"><strong>{incidentTypeLabels[item.incident_type]}</strong><Badge tone={item.verification_status === 'verified' ? 'success' : 'warning'}>{incidentStateLabel(item)}</Badge></span>
          <span className="flood-incident-card-description">{item.description}</span>
          <span className="flood-incident-card-meta"><time dateTime={item.event_time}>{incidentDate(item.event_time)}</time><span>{incidentSourceLabels[item.source_type]}</span>{incidentOfficialSource(item) && <span>⬡ Respaldo oficial</span>}{item.severity_reported !== 'unknown' && <span>Severidad {severityLabels[item.severity_reported].toLowerCase()}</span>}</span>
        </button>)}
        {list?.has_more && <p className="muted">Hay más reportes. Acota los filtros para localizarlos.</p>}
      </div>
      {report && <section className="flood-incident-detail" aria-label="Detalle del reporte seleccionado">
        <div className="flood-incident-detail-actions"><Button variant="ghost" onClick={() => onSelect('')}>← Volver a la lista</Button>{!withdrawn && !['rejected', 'expired'].includes(report.verification_status) && <Button variant="secondary" onClick={() => onLocate?.(report.incident_id)}><MapPin size={14} />Ubicar en mapa</Button>}</div>
        <h3>{incidentTypeLabels[report.incident_type]}</h3><p>{report.description}</p>
        <p className="flood-incident-card-meta"><span>{incidentStateLabel(report)}</span><span>{incidentSourceLabels[report.source_type]}</span><time dateTime={report.event_time}>{incidentDate(report.event_time)}</time></p>
        {report.severity_reported !== 'unknown' && <p>Severidad: {severityLabels[report.severity_reported]}</p>}
        {source && <p>⬡ Respaldo oficial: <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>. Se conserva el origen {report.source_type === 'citizen' ? 'ciudadano' : 'del reporte'}.</p>}
        {report.moderation_note && <p className="muted">Motivo de revisión: {report.moderation_note}</p>}
        {detailLoading && <p role="status">Actualizando reporte…</p>}{detailError && <ErrorState error={detailError} onRetry={onRetry} />}
        {authorized && !inactive && <div className="flood-incident-moderation">
          <div className="flood-moderation-actions" aria-label="Acciones de moderación">
            {['pending', 'corroborated'].includes(report.verification_status) && <Button variant="secondary" disabled={disabled} onClick={() => submit('verify')}><ShieldCheck size={14} />Verificar</Button>}
            {report.verification_status !== 'rejected' && <Button variant="secondary" disabled={disabled} onClick={() => { setForm('reject'); setConfirmation(''); }}>Rechazar</Button>}
            {permissions?.can_mark_official && report.source_type !== 'synthetic' && !source && <Button variant="secondary" disabled={disabled || report.verification_status === 'rejected'} onClick={() => { setForm('official'); setConfirmation(''); }}>Marcar como oficial</Button>}
            {permissions?.can_withdraw && <Button variant="ghost" disabled={disabled} onClick={() => { setForm('withdraw'); setConfirmation(''); }}>Retirar del mapa</Button>}
          </div>
          {form && <form className="flood-moderation-form" onSubmit={event => { event.preventDefault(); submit(form); }}>
            {form === 'official' && <><p>Vincula una publicación oficial revisada. Esto acredita respaldo documental y conserva la procedencia original; el enlace no se verifica automáticamente.</p><label>Publicación o entidad responsable<input required minLength={3} maxLength={160} value={sourceTitle} disabled={review.isPending} onChange={event => setSourceTitle(event.target.value)} /></label><label>Enlace a la fuente oficial<input type="url" required pattern="https://.*" maxLength={2048} value={sourceURL} disabled={review.isPending} onChange={event => setSourceURL(event.target.value)} /></label><label className="flood-official-ack"><input type="checkbox" required checked={sourceAck} disabled={review.isPending} onChange={event => setSourceAck(event.target.checked)} />He revisado la publicación oficial que respalda esta novedad.</label></>}
            {form === 'withdraw' && <p>El reporte dejará de aparecer en el mapa. Se conserva su registro y su historial.</p>}
            <label>{form === 'reject' ? 'Motivo del rechazo' : 'Nota de revisión'}<textarea required={form === 'reject'} maxLength={280} rows={2} value={note} disabled={review.isPending} onChange={event => setNote(event.target.value)} /></label>
            <div className="flood-moderation-actions"><Button type="submit" disabled={disabled}>{review.isPending ? 'Guardando…' : 'Confirmar revisión'}</Button><Button type="button" variant="ghost" disabled={review.isPending} onClick={() => setForm(undefined)}>Volver</Button></div>
          </form>}
        </div>}
        {review.error && <ErrorState error={review.error} onRetry={() => review.reset()} />}
        {confirmation && <p role="status">{confirmation}</p>}
      </section>}
    </div>}
    <div className="flood-moderation-access">{access}</div>
  </Card>;
}
