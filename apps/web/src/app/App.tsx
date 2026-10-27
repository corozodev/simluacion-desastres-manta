import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { ScenarioScreen } from '../features/ScenarioScreen';

export function AppRoutes() {
  return <Routes><Route element={<AppShell />}><Route path="escape" element={<ScenarioScreen />} /><Route path="*" element={<Navigate to="/escape" replace />} /></Route></Routes>;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false }, mutations: { retry: false } } });

export default function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><AppRoutes /></BrowserRouter></QueryClientProvider>;
}
