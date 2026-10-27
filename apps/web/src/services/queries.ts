import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useWorld(enabled = true) {
  return useQuery({ queryKey: ['world'], queryFn: ({ signal }) => api.world(signal), retry: false, refetchInterval: 2000, staleTime: 0, enabled });
}

export function useGraph(runId?: string, mode?: string) {
  return useQuery({ queryKey: ['graph', runId ?? '', mode ?? ''], queryFn: ({ signal }) => api.graph(signal, { runId, mode }), retry: false, staleTime: Infinity });
}

export function useFloodState(enabled = true) {
  return useQuery({ queryKey: ['flood', 'state'], queryFn: ({ signal }) => api.floodState(signal), retry: false, refetchInterval: 500, staleTime: 0, enabled });
}

export function useFloodCatalog() {
  return useQuery({ queryKey: ['flood', 'catalog'], queryFn: ({ signal }) => api.floodCatalog(signal), retry: false, staleTime: Infinity });
}

export function useFloodGraph(runId?: string, mode?: string) {
  return useQuery({ queryKey: ['flood', 'graph', runId ?? '', mode ?? ''], queryFn: ({ signal }) => api.floodGraph(signal, { runId, mode }), retry: false, staleTime: Infinity });
}

export function useFloodSession() {
  return useQuery({ queryKey: ['flood', 'session'], queryFn: ({ signal }) => api.floodSession(signal), retry: false, staleTime: 10 * 60 * 1000 });
}
