import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useWorld(enabled = true) {
  return useQuery({ queryKey: ['world'], queryFn: ({ signal }) => api.world(signal), retry: false, refetchInterval: 2000, staleTime: 0, enabled });
}

export function useGraph(runId?: string, mode?: string) {
  return useQuery({ queryKey: ['graph', runId ?? '', mode ?? ''], queryFn: ({ signal }) => api.graph(signal, { runId, mode }), retry: false, staleTime: Infinity });
}
