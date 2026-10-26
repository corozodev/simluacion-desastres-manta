import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/ui';
import { Overview } from '../features/Overview';
import { ItemDetail, Items } from '../features/Items';
import { DemoForm } from '../features/DemoForm';
import { Escape } from '../features/Escape';
import { Diagnostics } from '../features/Diagnostics';

export function AppRoutes() {
  return <Routes><Route element={<AppShell />}><Route index element={<Overview />} /><Route path="escape" element={<Escape />} /><Route path="items" element={<Items />} /><Route path="items/:id" element={<ItemDetail />} /><Route path="demo" element={<DemoForm />} /><Route path="diagnostics" element={<Diagnostics />} /><Route path="*" element={<EmptyState title="Esta página no existe" description="Puedes continuar desde el resumen del workspace." action={<Link to="/" className="button button-primary">Volver al inicio</Link>} />} /></Route></Routes>;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false }, mutations: { retry: false } } });

export default function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><AppRoutes /></BrowserRouter></QueryClientProvider>;
}
