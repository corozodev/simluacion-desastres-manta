import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A body portal avoids clipping by the map's scrolling configuration panels. */
export function ActionMenu({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220, maxHeight: 300 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(0, Math.min(220, window.innerWidth - 16));
      const height = Math.min(menu.current?.scrollHeight ?? 180, window.innerHeight - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const top = below >= height || below >= rect.top - 12 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
      setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top, width, maxHeight: Math.max(0, window.innerHeight - top - 8) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
      if (event.key === 'Tab') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <>
    <button ref={trigger} className="button button-secondary" aria-label="Más acciones" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen(value => !value)}>⋯</button>
    {open && createPortal(<div id={id} ref={menu} role="menu" aria-label="Más acciones de simulación" className="flood-action-menu" style={{ position: 'fixed', ...position }} onClick={event => {
      const button = (event.target as HTMLElement).closest('button');
      if (button && !button.disabled) { setOpen(false); trigger.current?.focus(); }
    }} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>{children}</div>, document.body)}
  </>;
}
