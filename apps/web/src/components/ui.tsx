import { AlertCircle, ArrowRight, Inbox, LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { ApiError } from '../services/api';

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props} />;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'purple' | 'cyan' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({ title = 'No encontramos sobrevivientes', description = 'Prueba con otra búsqueda para encontrar lo que necesitas.', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="state empty-state"><span className="state-icon"><Inbox size={28} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const status = error instanceof ApiError ? error.status : undefined;
  const isNotFound = status === 404;
  const title = status === 401 || status === 403 ? 'Se requiere autorización' : isNotFound ? 'Este recurso no existe' : status === 410 ? 'La ejecución ha caducado' : status === 409 ? 'Conflicto de ejecución' : status === 400 || status === 422 ? 'Revisa la configuración' : status === 429 ? 'Límite temporal alcanzado' : 'No se pudo completar la operación';
  return <div className="state error-state" role="alert"><span className="state-icon"><AlertCircle size={26} /></span><h3>{title}</h3><p>{error.message}</p>
    {error instanceof ApiError && error.requestId && <code className="request-id">Request ID: {error.requestId}</code>}
    {onRetry && !isNotFound && <Button variant="secondary" onClick={onRetry}>Intentar de nuevo <ArrowRight size={15} /></Button>}</div>;
}

export function LoadingState({ label = 'Consultando evacuación…' }: { label?: string }) {
  return <div className="state loading-state" role="status"><LoaderCircle className="spin" size={26} /><p>{label}</p><div className="skeleton-lines" aria-hidden="true"><span /><span /><span /></div></div>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p className="page-description">{description}</p></div>{action && <div className="page-header-action">{action}</div>}</div>;
}

export function StatusIndicator({ status, compact = false }: { status: 'online' | 'offline' | 'checking' | 'degraded'; compact?: boolean }) {
  const labels = { online: 'API evacuación conectada', offline: 'API evacuación sin conexión', checking: 'Comprobando evacuación', degraded: 'API evacuación degradada' };
  const shortLabels = { online: 'Conectada', offline: 'Sin conexión', checking: 'Conectando', degraded: 'Degradada' };
  return <span title={labels[status]} className={`status-indicator status-${status} ${compact ? 'status-compact' : ''}`}><span className="status-dot" aria-hidden="true" /><span className="status-label">{labels[status]}</span>{compact && <span className="status-short-label" aria-hidden="true">{shortLabels[status]}</span>}</span>;
}
