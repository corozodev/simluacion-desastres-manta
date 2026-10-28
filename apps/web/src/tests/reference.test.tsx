import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
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
  it('enlaza la procedencia real y distingue red vial, relieve sintético y susceptibilidad oficial', () => {
    panel();
    expect(screen.getByRole('link', { name: 'Consultar la fuente oficial' })).toHaveAttribute('href', bundle.susceptibility.provenance.url);
    expect(screen.getByLabelText('Procedencia y límites de los datos')).toHaveTextContent('red vial OpenStreetMap');
    expect(screen.getByLabelText('Procedencia y límites de los datos')).toHaveTextContent('relieve sintético');
    expect(screen.getByLabelText('Procedencia y límites de los datos')).toHaveTextContent('no representa agua presente ni confirma una incidencia ciudadana');
    expect(screen.queryByRole('button', { name: 'Actualizar copia oficial' })).not.toBeInTheDocument();
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
  it('conserva fechas y procedencia de los eventos históricos en HTTP sin iniciar ni aplicar una simulación', async () => {
    const create = vi.spyOn(api, 'startFlood');
    const apply = vi.spyOn(api, 'applyFloodIncident');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(bundle.rain_events), { status: 200 })));
    const history = await api.rainEvents();
    expect(history).toEqual(bundle.rain_events);
    expect(history.events).toHaveLength(16);
    expect(history.events).toContainEqual(expect.objectContaining({ event_date: '2025-04-14', canton: 'MANTA', event: 'Deslizamiento', declared_update_date: '2025-04-15' }));
    expect(create).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
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
