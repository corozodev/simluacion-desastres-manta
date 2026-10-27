import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SimulationCreateRequest, SimulationCreated, SimulationState } from '@corodev/contracts';
import { api, ApiError } from './api';
import { config } from '../lib/config';

export const simulationStorageKey = 'corodev.simulation-session.v1';
type Credentials = { simulation_id: string; access_token: string; endpoint: string };
export const isTerminal = (status?: string) => status === 'COMPLETED' || status === 'CANCELLED' || status === 'FAILED';
const unavailable = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status ?? 0);

function restore(): Credentials | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(simulationStorageKey) ?? 'null');
    if (value && typeof value === 'object' && 'simulation_id' in value && typeof value.simulation_id === 'string'
      && 'access_token' in value && typeof value.access_token === 'string' && value.access_token.length > 0
      && 'endpoint' in value && value.endpoint === config.worldApiBaseUrl) return value as Credentials;
    sessionStorage.removeItem(simulationStorageKey);
  } catch { /* A blocked browser store still permits an in-memory session. */ }
  return null;
}

export function useSimulationCapabilities() {
  return useQuery({ queryKey: ['simulation-capabilities'], queryFn: ({ signal }) => api.simulationCapabilities(signal), staleTime: 60_000, retry: false });
}

// Only the explicit mutations create work. Rehydration and polling are GETs.
export function useSimulationSession() {
  const client = useQueryClient();
  const [credentials, setCredentials] = useState<Credentials | null>(restore);
  const [notice, setNotice] = useState('');
  const gate = useRef(false);
  const creation = useRef<{ body: string; key: string } | null>(null);
  const restartKey = useRef<string | null>(null);
  const failures = useRef(0);
  const id = credentials?.simulation_id;
  const stateKey = ['simulation-session', id ?? '', 'state'];
  const state = useQuery({ queryKey: stateKey,
    queryFn: async ({ signal }) => {
      try {
        const result = await api.simulationState(credentials!.simulation_id, credentials!.access_token, signal);
        failures.current = 0;
        return result;
      } catch (error) { if (!signal.aborted) failures.current++; throw error; }
    }, enabled: Boolean(credentials), retry: false, staleTime: 0, gcTime: 0,
    refetchInterval: query => unavailable(query.state.error) || isTerminal(query.state.data?.status) ? false : Math.min(30_000, 2000 * 2 ** Math.min(4, failures.current)),
    refetchOnWindowFocus: false, refetchOnReconnect: true,
  });
  const results = useQuery({ queryKey: ['simulation-session', id ?? '', 'results'],
    queryFn: ({ signal }) => api.simulationResults(credentials!.simulation_id, credentials!.access_token, signal),
    enabled: Boolean(credentials) && isTerminal(state.data?.status), retry: false, gcTime: 0,
  });
  const forget = (message = '') => {
    try { sessionStorage.removeItem(simulationStorageKey); } catch { /* storage unavailable */ }
    setCredentials(null);
    setNotice(message);
    failures.current = 0;
    creation.current = null;
    restartKey.current = null;
    start.reset();
    control.reset();
    restart.reset();
    void client.cancelQueries({ queryKey: ['simulation-session'] });
    client.removeQueries({ queryKey: ['simulation-session'] });
  };
  useEffect(() => {
    if (unavailable(state.error) || unavailable(results.error)) forget('Tu simulación ya no está disponible. Puede haber caducado o el servidor se reinició. Puedes iniciar una nueva.');
  }, [state.error, results.error]);
  const remember = (metadata: SimulationCreated) => {
    if (!metadata.access_token) throw new ApiError('No recibimos la credencial de la simulación.', 'INVALID_RESPONSE');
    const next = { simulation_id: metadata.simulation_id, access_token: metadata.access_token, endpoint: config.worldApiBaseUrl };
    setNotice('');
    try { sessionStorage.setItem(simulationStorageKey, JSON.stringify(next)); } catch { setNotice('La recuperación al actualizar no está disponible en este navegador.'); }
    setCredentials(next);
    failures.current = 0;
    creation.current = null;
    restartKey.current = null;
    start.reset();
    control.reset();
    restart.reset();
  };
  const start = useMutation({ mutationFn: (input: SimulationCreateRequest) => {
    const body = JSON.stringify(input);
    if (creation.current?.body !== body) creation.current = { body, key: crypto.randomUUID() };
    return api.createSimulation(input, creation.current.key);
  }, onSuccess: remember });
  const control = useMutation({ mutationFn: (action: 'pause' | 'resume' | 'cancel') => api.controlSimulation(credentials!.simulation_id, credentials!.access_token, action),
    onSuccess: async metadata => {
      await client.cancelQueries({ queryKey: stateKey });
      client.setQueryData<SimulationState>(stateKey, previous => previous ? { ...previous, ...metadata } : previous);
      await client.invalidateQueries({ queryKey: stateKey });
    }, onError: () => { void state.refetch(); },
  });
  const restart = useMutation({ mutationFn: () => {
    restartKey.current ??= crypto.randomUUID();
    return api.restartSimulation(credentials!.simulation_id, credentials!.access_token, restartKey.current);
  }, onSuccess: metadata => { client.removeQueries({ queryKey: ['simulation-session'] }); remember(metadata); } });
  const once = async (action: () => Promise<unknown>) => {
    if (gate.current) return;
    gate.current = true;
    try { await action(); } catch { /* React Query exposes the structured error. */ } finally { gate.current = false; }
  };
  return { id, state, results, notice, forget,
    busy: start.isPending || control.isPending || restart.isPending,
    error: start.error ?? control.error ?? restart.error,
    start: (input: SimulationCreateRequest) => once(() => start.mutateAsync(input)),
    control: (action: 'pause' | 'resume' | 'cancel') => once(() => control.mutateAsync(action)),
    restart: () => once(() => restart.mutateAsync()),
  };
}
