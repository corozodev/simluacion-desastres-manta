import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
const AppShell = lazy(() => import('../components/AppShell').then(module => ({ default: module.AppShell })));
const ScenarioScreen = lazy(() => import('../features/ScenarioScreen').then(module => ({ default: module.ScenarioScreen })));
const MobileViewer = lazy(() => import('../features/mobile/MobileViewer'));

export function AppRoutes() {
  return <Suspense fallback={<p role="status">Cargando MantaSim…</p>}><Routes><Route path="mobile" element={<MobileViewer />} /><Route element={<AppShell />}><Route path="escape" element={<ScenarioScreen />} /><Route path="flood-lab" element={<ScenarioScreen />} /><Route path="*" element={<Navigate to="/escape" replace />} /></Route></Routes></Suspense>;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false }, mutations: { retry: false } } });

export default function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><AppRoutes /></BrowserRouter></QueryClientProvider>;
}
