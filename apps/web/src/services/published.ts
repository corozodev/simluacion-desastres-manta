import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

// Browser offline events can pause TanStack requests before they fail. Expose
// that state directly so the retained snapshot is never presented as current.
export function useNetworkOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}

// Each observer reads the current immutable snapshot. Discovery continues slowly
// after a final, so a new public execution is found without replaying history.
export function usePublishedZombie(active: boolean) {
  const failures = useRef(0);
  return useQuery({ queryKey: ['published', 'zombie_outbreak'], enabled: active,
    queryFn: async ({ signal }) => {
      try { const value = await api.publishedSimulation('zombie_outbreak', signal); failures.current = 0; return value; }
      catch (error) { if (!signal.aborted) failures.current++; throw error; }
    }, staleTime: 0, retry: false, refetchOnReconnect: true, refetchOnWindowFocus: true,
    refetchInterval: query => active ? failures.current ? Math.min(30000, 2000 * 2 ** failures.current) : query.state.data?.simulation?.status === 'RUNNING' ? 2000 : 15000 : false,
  });
}
export function usePublishedFlood(active: boolean) {
  const failures = useRef(0);
  return useQuery({ queryKey: ['published', 'urban_flood'], enabled: active,
    queryFn: async ({ signal }) => {
      try { const value = await api.publishedFlood(signal); failures.current = 0; return value; }
      catch (error) { if (!signal.aborted) failures.current++; throw error; }
    }, staleTime: 0, retry: false, refetchOnReconnect: true, refetchOnWindowFocus: true,
    refetchInterval: query => active ? failures.current ? Math.min(30000, 2000 * 2 ** failures.current) : query.state.data?.state === 'running' ? 2000 : 15000 : false,
  });
}
