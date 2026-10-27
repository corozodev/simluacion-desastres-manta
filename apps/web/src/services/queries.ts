import { useQuery } from '@tanstack/react-query';
import { api, type IncidentFilters } from './api';

export function useWorld(enabled = true) {
  return useQuery({ queryKey: ['world'], queryFn: ({ signal }) => api.world(signal), retry: false, refetchInterval: 2000, staleTime: 0, enabled });
}

export function useGraph(runId?: string, mode?: string) {
  return useQuery({ queryKey: ['graph', runId ?? '', mode ?? ''], queryFn: ({ signal }) => api.graph(signal, { runId, mode }), retry: false, staleTime: Infinity });
}

export function useFloodState(enabled = true) {
  return useQuery({ queryKey: ['flood', 'state'], queryFn: ({ signal }) => api.floodState(signal), retry: false, refetchInterval: 500, staleTime: 0, enabled,
    structuralSharing: (previous, next) => {
      const oldState = previous as Awaited<ReturnType<typeof api.floodState>> | undefined;
      const newState = next as Awaited<ReturnType<typeof api.floodState>>;
      if (oldState?.run_id === newState.run_id && (oldState.scenario.world_version > newState.scenario.world_version || oldState.state === 'cancelled' && newState.state !== 'cancelled')) return oldState;
      return newState;
    },
  });
}

export function useFloodCatalog() {
  return useQuery({ queryKey: ['flood', 'catalog'], queryFn: ({ signal }) => api.floodCatalog(signal), retry: false, staleTime: Infinity });
}

export function useFloodGraph(runId?: string, mode?: string) {
  return useQuery({ queryKey: ['flood', 'graph', runId ?? '', mode ?? ''], queryFn: ({ signal }) => api.floodGraph(signal, { runId, mode }), retry: false, staleTime: Infinity });
}

export function useFloodSession(enabled = true) {
  return useQuery({ queryKey: ['flood', 'session'], queryFn: ({ signal }) => api.floodSession(signal), retry: false, staleTime: 0, refetchInterval: enabled ? 30000 : false, enabled });
}

export function useIncidents(filters: IncidentFilters = {}, enabled = true) {
  return useQuery({ queryKey: ['incidents', 'list', filters], queryFn: ({ signal }) => api.incidents(filters, signal), retry: false, refetchInterval: 5000, staleTime: 0, enabled });
}

export function useIncidentDetail(id?: string) {
  return useQuery({ queryKey: ['incidents', 'detail', id ?? ''], queryFn: ({ signal }) => api.incident(id ?? '', signal), retry: false, refetchInterval: 5000, staleTime: 0, enabled: Boolean(id) });
}

export function useIncidentModerationPermissions(enabled = true) {
  return useQuery({ queryKey: ['incidents', 'permissions'], queryFn: ({ signal }) => api.incidentModerationPermissions(signal), retry: false, refetchInterval: enabled ? 30000 : false, staleTime: 0, enabled });
}

export function useIncidentInfo() {
  return useQuery({ queryKey: ['incidents', 'config'], queryFn: ({ signal }) => api.incidentInfo(signal), retry: false, staleTime: Infinity });
}

export function useReferenceStatus() {
  return useQuery({ queryKey: ['reference', 'status'], queryFn: ({ signal }) => api.referenceStatus(signal), retry: false, refetchInterval: 30000, staleTime: 10000 });
}
export function useSusceptibilityReference(version?: string, enabled = false) {
  return useQuery({ queryKey: ['reference', 'polygons', version ?? ''], queryFn: ({ signal }) => api.susceptibilityReference(version ?? '', signal), retry: false, enabled: Boolean(version) && enabled, staleTime: Infinity });
}
