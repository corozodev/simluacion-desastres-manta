import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LabSession } from '@corodev/contracts';
import { api } from '../services/api';
import { Button, ErrorState } from './ui';

/** Operator credentials are submitted once; only the HttpOnly cookie persists. */
export function OperatorAccess({ session, loading, error, retry }: { session?: LabSession; loading: boolean; error: Error | null; retry: () => void }) {
  const client = useQueryClient();
  const [operator, setOperator] = useState('');
  const accessCode = useRef<HTMLInputElement>(null);
  const gate = useRef(false);
  const login = useMutation({ mutationFn: async () => {
    const code = accessCode.current?.value ?? '';
    if (accessCode.current) accessCode.current.value = '';
    await api.login(operator, code);
    // The laboratory is the authority for its own control permission. A login
    // ACK alone must never enable storm controls.
    await client.cancelQueries({ queryKey: ['flood', 'session'] });
    const permission = await api.floodSession();
    client.setQueryData(['flood', 'session'], permission);
    if (!permission.authenticated) throw new Error('La sesión no habilita este laboratorio. Revisa el origen y la configuración del servicio.');
  } });
  if (loading) return <p role="status">Comprobando sesión de operador…</p>;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (session?.authenticated) return <p className="operator-access" role="status">Sesión de control disponible.</p>;
  if (!session?.enabled) return <p className="operator-access" role="status">Sólo observación. El acceso de operador está deshabilitado en esta instancia.</p>;
  return <details className="operator-access" open>
    <summary>Acceso de operador</summary>
    <p>Se requiere sesión de operador para ejecutar.</p>
    <form className="simulation-form" onSubmit={event => {
      event.preventDefault();
      if (gate.current) return;
      gate.current = true;
      void login.mutateAsync().catch(() => {}).finally(() => { gate.current = false; });
    }}>
      <label>Operador<input autoComplete="username" maxLength={64} required value={operator} disabled={login.isPending} onChange={event => setOperator(event.target.value)} /></label>
      <label>Código de acceso<input ref={accessCode} type="password" autoComplete="off" minLength={43} maxLength={43} required disabled={login.isPending} /></label>
      <Button type="submit" disabled={login.isPending}>{login.isPending ? 'Verificando…' : 'Iniciar sesión de operador'}</Button>
    </form>
    {login.error && <ErrorState error={login.error} />}
  </details>;
}
