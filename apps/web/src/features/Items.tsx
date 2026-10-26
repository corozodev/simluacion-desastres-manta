import { ArrowLeft, ArrowRight, Box, CalendarDays, Fingerprint, Plus, SearchX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SearchInput } from '../components/ui';
import { formatDate, ItemList, ItemStatus, PaginationControls } from '../components/ItemList';
import { useItems } from '../services/queries';
import { api } from '../services/api';

export function Items() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [search, setSearch] = useState(query);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSearch(query); }, [query]);
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => setParams(search ? { q: search } : {}, { replace: true }), 300);
    return () => clearTimeout(timer);
  }, [search, query, setParams]);
  const items = useItems(page, 6, query);
  return <div className="page"><PageHeader eyebrow="EXPLORA EL STARTER" title="Elementos" description="Una colección de datos de ejemplo para probar el flujo de principio a fin." action={<Link className="button button-primary" to="/demo"><Plus size={17} />Nuevo envío demo</Link>} />
    <Card className="items-card"><div className="items-toolbar"><SearchInput value={search} onChange={setSearch} inputRef={inputRef} /><div className="items-count"><Box size={16} />{items.data?.pagination.total ?? '—'} elementos<Badge tone="purple">DEMO</Badge></div></div>
      <div className="items-column-labels"><span>ELEMENTO</span><span>ESTADO / FECHA DE EJEMPLO</span></div>
      <div aria-busy={items.isFetching}>{items.isPending ? <LoadingState /> : items.isError ? <ErrorState error={items.error} onRetry={() => void items.refetch()} /> : items.data.data.length === 0 ? <EmptyState title={query ? `Sin resultados para “${query}”` : 'Todavía no hay elementos'} description={query ? 'Prueba otro título o palabra de la descripción.' : 'La API está conectada, pero esta colección está vacía.'} action={query && <Button variant="secondary" onClick={() => { setSearch(''); setParams({}); }}><SearchX size={16} />Limpiar búsqueda</Button>} /> : <ItemList items={items.data.data} />}</div>
      {items.isSuccess && <PaginationControls pagination={items.data.pagination} disabled={items.isPlaceholderData} onPage={next => setParams({ ...(query ? { q: query } : {}), page: String(next) })} />}</Card>
    <p className="page-note"><span className="note-dot" />Estos elementos son datos de demostración. Las fechas son ejemplos fijos.</p>
  </div>;
}

export function ItemDetail() {
  const { id = '' } = useParams();
  const item = useQuery({ queryKey: ['item', id], queryFn: ({ signal }) => api.item(id, signal) });
  return <div className="page detail-page"><Link className="back-link" to="/items"><ArrowLeft size={16} />Volver a elementos</Link>
    {item.isPending ? <Card><LoadingState label="Cargando detalle…" /></Card> : item.isError ? <Card><ErrorState error={item.error} onRetry={() => void item.refetch()} /></Card> : <><PageHeader eyebrow="DETALLE DEL ELEMENTO" title={item.data.title} description="Un registro de ejemplo obtenido directamente desde la API." action={<ItemStatus status={item.data.status} />} />
      <Card className="detail-card"><span className="detail-symbol icon-orange"><Box size={32} /></span><div><Badge>DATOS DE DEMOSTRACIÓN</Badge><h2>{item.data.title}</h2><p className="detail-description">{item.data.description}</p></div><dl className="detail-properties"><div><dt><Fingerprint size={17} />Identificador</dt><dd><code>{item.data.id}</code></dd></div><div><dt><CalendarDays size={17} />Fecha de ejemplo</dt><dd>{formatDate(item.data.createdAt)}</dd></div><div><dt><Box size={17} />Estado</dt><dd><ItemStatus status={item.data.status} /></dd></div></dl><div className="detail-note">La fecha pertenece al conjunto de datos de ejemplo; no indica una ejecución real.</div></Card>
      <Link to="/demo" className="text-link detail-next">Prueba también el formulario demo<ArrowRight size={16} /></Link></>}
  </div>;
}
