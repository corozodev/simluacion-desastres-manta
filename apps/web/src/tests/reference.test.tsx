import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Graph, ReferenceCollection, OfficialRainEvents, ReferenceStatus } from '@corodev/contracts';
import { ReferencePanel } from '../features/flood/ReferencePanel';
import { FloodMap } from '../features/flood/FloodMap';
import { api } from '../services/api';

const bundle = (JSON.parse(readFileSync('../../services/evacuation/data/reference/manta-official.json', 'utf8')) as { bundle: { susceptibility: ReferenceCollection; rain_events: OfficialRainEvents } }).bundle;
const graph = JSON.parse(readFileSync('../../services/evacuation/data/manta-v2.json', 'utf8')) as Graph;
const status: ReferenceStatus = { schema_version: 1, mode: 'offline', availability: 'cached', refreshing: false, provider_status: 'offline', message: 'Copia oficial con fecha y origen; no inundación actual.', dataset_version: bundle.susceptibility.provenance.dataset_version, event_dataset_version: bundle.rain_events.provenance.dataset_version, provenance: bundle.susceptibility.provenance, feature_count: 59, vertex_count: 3463, metrics: { queries: 0, provider_errors: 0, cache_hits: 0, cache_misses: 0, last_query_ms: 0, total_query_ms: 0, response_bytes: 0, last_refresh_ms: 0 } };
function panel(value = status) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReferencePanel status={value} collection={bundle.susceptibility} loading={false} error={null} retry={() => {}} csrf="test-only" /></QueryClientProvider>); }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('referencia territorial oficial', () => {
  it('muestra atribución, CRS, años y copia offline sin convertir susceptibilidad en inundación actual', () => {
    panel();
    expect(screen.getByText(/CONAGE 2024 — resoluciones/)).toBeInTheDocument();
    expect(screen.getByText(/EPSG:32717 → EPSG:4326/)).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.getByText(/Esta ejecución utiliza terreno y parámetros sintéticos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actualizar copia oficial' })).toBeDisabled();
    expect(screen.getByText(/Un polígono ALTA no significa que esté inundado ahora/)).toBeInTheDocument();
  });
  it('conserva un control independiente y renderiza polígonos memoizados con agujeros evenodd', () => {
    function View() { const [show, setShow] = useState(false); return <FloodMap graph={graph} shelters={graph.shelters} candidates={[]} selectedAgentId="" onSelectAgent={() => {}} onPickPosition={() => {}} reference={bundle.susceptibility} showReference={show} onShowReference={setShow} />; }
    const { container } = render(<View />);
    const toggle = screen.getByRole('checkbox', { name: 'Susceptibilidad oficial a inundaciones' });
    expect(toggle).not.toBeChecked();
    expect(container.querySelector('[data-layer="official-susceptibility"]')).toBeNull();
    fireEvent.click(toggle);
    expect(container.querySelectorAll('[data-reference-id]')).toHaveLength(59);
    expect(container.querySelector('[data-reference-id]')).toHaveAttribute('fill-rule', 'evenodd');
    expect(container.querySelectorAll('[data-road-state]')).toHaveLength(3);
    fireEvent.click(toggle);
    expect(container.querySelector('[data-layer="official-susceptibility"]')).toBeNull();
  });
  it('consulta eventos con sus fechas originales y sin operación de aplicación al motor', async () => {
    const history = vi.spyOn(api, 'rainEvents').mockResolvedValue(bundle.rain_events);
    panel();
    const details = screen.getByText('Eventos históricos por lluvias · official_observation').closest('details')!;
    details.open = true; fireEvent(details, new Event('toggle'));
    await waitFor(() => expect(history).toHaveBeenCalledOnce());
    expect(await screen.findByText(/2025-04-14 · MANTA · Deslizamiento/)).toBeInTheDocument();
    expect(screen.getByText(/actualización declarada: 2025-04-15/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aplicar incidente a simulación' })).not.toBeInTheDocument();
  });
  it('el adaptador rechaza coordenadas proyectadas y versiones cambiadas', async () => {
    const invalid = structuredClone(bundle.susceptibility);
    invalid.features[0]!.geometry.coordinates[0]![0]![0] = [500000, 9890000];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid), { status: 200 })));
    await expect(api.susceptibilityReference(status.dataset_version!)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(bundle.susceptibility), { status: 200 })));
    await expect(api.susceptibilityReference('changed-version')).rejects.toMatchObject({ code: 'REFERENCE_CHANGED' });
    vi.unstubAllGlobals();
  });
});
