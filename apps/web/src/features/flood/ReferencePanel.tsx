import type { ReferenceStatus, ReferenceCollection, ReferenceUse } from '@corodev/contracts';
import { ErrorState } from '../../components/ui';

export function ReferencePanel({ status, collection, loading, error, retry }: { status?: ReferenceStatus; collection?: ReferenceCollection; loading: boolean; error: Error | null; retry: () => void; csrf?: string; active?: ReferenceUse }) {
  const provenance = collection?.provenance ?? status?.provenance;
  return <div className="flood-source-summary" aria-label="Procedencia y límites de los datos">
    <p><strong>Geografía:</strong> red vial OpenStreetMap. Los refugios y agentes del laboratorio son experimentales.</p>
    <p><strong>Simulación:</strong> lluvia y profundidades calculadas sobre relieve sintético, sin validación hidráulica local. No es un pronóstico ni una alerta oficial.</p>
    <p><strong>Referencia oficial:</strong> susceptibilidad territorial; no representa agua presente ni confirma una incidencia ciudadana. {provenance && /^https?:\/\//i.test(provenance.url) ? <a href={provenance.url} target="_blank" rel="noreferrer">Consultar la fuente oficial</a> : 'La fuente oficial no está disponible en esta instancia.'}</p>
    {loading && <p role="status">Consultando procedencia…</p>}
    {error && <ErrorState error={error} onRetry={retry} />}
  </div>;
}
