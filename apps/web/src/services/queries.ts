import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useHealth(enabled = true) {
  return useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal), retry: false, refetchInterval: 30000, enabled });
}

export function useItems(page = 1, pageSize = 6, search = '') {
  return useQuery({ queryKey: ['items', page, pageSize, search], queryFn: ({ signal }) => api.items(page, pageSize, search, signal), placeholderData: keepPreviousData });
}

export function useWorld(enabled = true) {
  return useQuery({ queryKey: ['world'], queryFn: ({ signal }) => api.world(signal), retry: false, refetchInterval: 2000, staleTime: 0, enabled });
}

export function useGraph() {
  return useQuery({ queryKey: ['graph'], queryFn: ({ signal }) => api.graph(signal), retry: false, staleTime: Infinity });
}
