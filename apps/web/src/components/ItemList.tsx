import { ArrowUpRight, Box, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DemoItem, Pagination } from '@corodev/contracts';
import { Badge, Button } from './ui';

const statuses = { active: { label: 'Activo', tone: 'success' }, pending: { label: 'Pendiente', tone: 'warning' }, completed: { label: 'Completado', tone: 'purple' } } as const;
export function ItemStatus({ status }: { status: DemoItem['status'] }) {
  const option = statuses[status];
  return <Badge tone={option.tone}><span className="badge-dot" />{option.label}</Badge>;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}

export function ItemList({ items, compact = false }: { items: DemoItem[]; compact?: boolean }) {
  return <ul className={`item-list ${compact ? 'item-list-compact' : ''}`}>{items.map((item, index) => <li key={item.id}>
    <Link to={`/items/${encodeURIComponent(item.id)}`} className="item-row"><span className={`item-icon item-icon-${index % 3}`}><Box size={20} strokeWidth={1.7} /></span>
      <div className="item-copy"><strong>{item.title}</strong><p>{item.description}</p></div>
      <div className="item-row-meta"><ItemStatus status={item.status} />{!compact && <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>}</div>
      <ArrowUpRight className="item-arrow" size={17} aria-hidden="true" /><span className="sr-only">Ver detalle de {item.title}</span></Link>
  </li>)}</ul>;
}

export function PaginationControls({ pagination, onPage, disabled = false }: { pagination: Pagination; onPage: (page: number) => void; disabled?: boolean }) {
  const pages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const start = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
  return <div className="pagination"><p>Mostrando <strong>{start}–{end}</strong> de <strong>{pagination.total}</strong> elementos</p>
    <div className="pagination-actions"><Button variant="secondary" aria-label="Página anterior" disabled={pagination.page <= 1 || disabled} onClick={() => onPage(pagination.page - 1)}><ChevronLeft size={16} /></Button>
      <span aria-live="polite">{pagination.page} <span className="muted">/ {pages}</span></span>
      <Button variant="secondary" aria-label="Página siguiente" disabled={pagination.page >= pages || disabled} onClick={() => onPage(pagination.page + 1)}><ChevronRight size={16} /></Button></div></div>;
}
