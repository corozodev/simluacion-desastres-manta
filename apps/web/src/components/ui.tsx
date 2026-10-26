import { AlertCircle, ArrowRight, CheckCircle2, Inbox, LoaderCircle, Search, X } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
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

export function TextField({ label, error, hint, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; id: string }) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...props} />
    {error && <span className="field-error" id={`${id}-error`}>{error}</span>}{hint && !error && <span className="field-hint" id={`${id}-hint`}>{hint}</span>}</div>;
}

export function SearchInput({ value, onChange, inputRef }: { value: string; onChange: (value: string) => void; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  return <div className="search-input"><Search size={18} aria-hidden="true" /><input type="search" ref={inputRef} aria-label="Buscar elementos" placeholder="Buscar por título o descripción…" value={value} onChange={event => onChange(event.target.value)} />
    {value && <button type="button" className="icon-button" aria-label="Limpiar búsqueda" onClick={() => onChange('')}><X size={16} /></button>}</div>;
}

export function EmptyState({ title = 'No encontramos elementos', description = 'Prueba con otra búsqueda para encontrar lo que necesitas.', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="state empty-state"><span className="state-icon"><Inbox size={28} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const isNotFound = error instanceof ApiError && error.status === 404;
  return <div className="state error-state" role="alert"><span className="state-icon"><AlertCircle size={26} /></span><h3>{isNotFound ? 'Este elemento no existe' : 'Algo interrumpió la conexión'}</h3><p>{error.message}</p>
    {error instanceof ApiError && error.requestId && <code className="request-id">Request ID: {error.requestId}</code>}
    {onRetry && !isNotFound && <Button variant="secondary" onClick={onRetry}>Intentar de nuevo <ArrowRight size={15} /></Button>}</div>;
}

export function LoadingState({ label = 'Cargando elementos…' }: { label?: string }) {
  return <div className="state loading-state" role="status"><LoaderCircle className="spin" size={26} /><p>{label}</p><div className="skeleton-lines" aria-hidden="true"><span /><span /><span /></div></div>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p className="page-description">{description}</p></div>{action && <div className="page-header-action">{action}</div>}</div>;
}

export function StatusIndicator({ status, compact = false }: { status: 'online' | 'offline' | 'checking'; compact?: boolean }) {
  const labels = { online: 'API conectada', offline: 'API sin conexión', checking: 'Comprobando API' };
  return <span className={`status-indicator status-${status} ${compact ? 'status-compact' : ''}`}><span className="status-dot" aria-hidden="true" />{labels[status]}</span>;
}

export function Toast({ title, children }: { title: string; children: ReactNode }) {
  return <div className="toast" role="status"><CheckCircle2 size={22} /><div><strong>{title}</strong><p>{children}</p></div></div>;
}
