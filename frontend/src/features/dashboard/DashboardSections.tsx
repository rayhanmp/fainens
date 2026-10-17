import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { GripVertical, MoveDiagonal, MoveDiagonal2 } from 'lucide-react';
import { dashboardSectionLabels, dashboardSectionRows, dashboardSectionSize, dashboardSectionWidth, moveDashboardSection, resetDashboardLayout, resizeDashboardSection, type DashboardSection, type DashboardSectionSize, type DashboardViewPreferences } from './view-preferences';

type DragSession = { id: DashboardSection; pointerId: number; x: number; y: number; target: DashboardSection | null; scroller: HTMLElement };
type ResizePreview = { id: DashboardSection; size: DashboardSectionSize; width: number; edge: 'left' | 'right' };
type ResizeSession = ResizePreview & { pointerId: number; startX: number; startWidth: number; candidates: { size: DashboardSectionSize; width: number }[] };
const gridSizes: DashboardSectionSize[] = ['small', 'wide', 'full'];
const sizeLabels = { small: 'Small', wide: 'Wide', full: 'Full width' };

function scrollContainer(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
}

export function DashboardSections({ preferences, sections, editing, onChange, onDone }: {
  preferences: DashboardViewPreferences;
  sections: Record<DashboardSection, ReactNode>;
  editing: boolean;
  onChange: (next: DashboardViewPreferences) => void;
  onDone: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  const frameRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState<DashboardSection | null>(null);
  const [dropTarget, setDropTarget] = useState<DashboardSection | null>(null);
  const [resizing, setResizing] = useState<ResizePreview | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const visibleIds = preferences.sectionOrder.filter(id => !preferences.hiddenSections.includes(id));

  useEffect(() => {
    if (!editing) {
      sessionRef.current = null;
      resizeRef.current = null;
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    }
    return () => {
      sessionRef.current = null;
      resizeRef.current = null;
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [editing]);

  const targetAtPointer = (session: DragSession) => {
    const element = document.elementFromPoint(session.x, session.y)?.closest<HTMLElement>('.dashboard-panel');
    const id = element?.dataset.section as DashboardSection | undefined;
    const target = element && rootRef.current?.contains(element) && id !== session.id && id && visibleIds.includes(id) ? id : null;
    session.target = target;
    setDropTarget(previous => previous === target ? previous : target);
  };

  const autoScroll = () => {
    const session = sessionRef.current;
    if (!session) return;
    const isPage = session.scroller === document.scrollingElement || session.scroller === document.documentElement;
    const bounds = isPage ? { top: 0, bottom: window.innerHeight } : session.scroller.getBoundingClientRect();
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(window.innerHeight, bounds.bottom);
    const distance = 48;
    const speed = session.y < top + distance ? -14 * Math.min(1, (top + distance - session.y) / distance)
      : session.y > bottom - distance ? 14 * Math.min(1, (session.y - bottom + distance) / distance) : 0;
    if (speed) session.scroller.scrollTop += speed;
    targetAtPointer(session);
    frameRef.current = requestAnimationFrame(autoScroll);
  };

  const cancelDrag = () => {
    sessionRef.current = null;
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    setDragging(null);
    setDropTarget(null);
  };

  const move = (from: DashboardSection, to: DashboardSection) => {
    const next = moveDashboardSection(preferences, from, to);
    if (next === preferences) return;
    onChange(next);
    const position = next.sectionOrder.filter(id => !next.hiddenSections.includes(id)).indexOf(from) + 1;
    setAnnouncement(`${dashboardSectionLabels[from]} moved to position ${position} of ${visibleIds.length}.`);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>(`[data-section="${from}"] .dashboard-drag-handle`)?.focus({ preventScroll: true }));
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: DashboardSection) => {
    if (event.button !== 0 || visibleIds.length < 2 || resizeRef.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    sessionRef.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, target: null, scroller: scrollContainer(event.currentTarget) };
    setDragging(id);
    setDropTarget(null);
    setAnnouncement(`Moving ${dashboardSectionLabels[id]}. Drop on another section or press Escape to cancel.`);
    frameRef.current = requestAnimationFrame(autoScroll);
  };

  const drag = (event: PointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    session.x = event.clientX;
    session.y = event.clientY;
    targetAtPointer(session);
  };

  const drop = (event: PointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    session.x = event.clientX;
    session.y = event.clientY;
    targetAtPointer(session);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    cancelDrag();
    if (session.target) move(session.id, session.target);
    else setAnnouncement('Move cancelled. Layout unchanged.');
  };

  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, id: DashboardSection) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      const pointerId = sessionRef.current?.pointerId;
      if (pointerId != null && event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId);
      cancelDrag();
      setAnnouncement('Move cancelled.');
      return;
    }
    const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const target = visibleIds[visibleIds.indexOf(id) + delta];
    if (target) move(id, target);
  };

  const cancelResize = () => { resizeRef.current = null; setResizing(null); };

  const startResize = (event: PointerEvent<HTMLButtonElement>, id: DashboardSection, edge: 'left' | 'right') => {
    const panel = event.currentTarget.closest<HTMLElement>('.dashboard-panel');
    const row = panel?.parentElement;
    if (event.button !== 0 || !rootRef.current || !panel || !row || !window.matchMedia('(min-width:1280px)').matches) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    cancelDrag();
    const width = panel.getBoundingClientRect().width;
    const available = rootRef.current.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const size = dashboardSectionSize(preferences, id);
    const candidates = [size, ...gridSizes.filter(value => value !== size)].map(value => ({
      size: value, width: dashboardSectionWidth(resizeDashboardSection(preferences, id, value), id, available, gap),
    }));
    resizeRef.current = { id, size, width, edge, pointerId: event.pointerId, startX: event.clientX, startWidth: width, candidates };
    setResizing({ id, size, width, edge });
    event.currentTarget.setPointerCapture(event.pointerId);
    setAnnouncement(`Resizing ${dashboardSectionLabels[id]}. Width snaps to the grid. Press Escape to cancel.`);
  };

  const resize = (event: PointerEvent<HTMLButtonElement>) => {
    const session = resizeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const desired = session.startWidth + (event.clientX - session.startX) * (session.edge === 'left' ? -1 : 1);
    const nearest = session.candidates.reduce((best, candidate) => Math.abs(candidate.width - desired) < Math.abs(best.width - desired) ? candidate : best);
    session.size = nearest.size;
    session.width = nearest.width;
    setResizing({ id: session.id, size: session.size, width: session.width, edge: session.edge });
  };

  const finishResize = (event: PointerEvent<HTMLButtonElement>) => {
    resize(event);
    const session = resizeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    cancelResize();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onChange(resizeDashboardSection(preferences, session.id, session.size));
    setAnnouncement(`${dashboardSectionLabels[session.id]} resized to ${sizeLabels[session.size]}.`);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>(`[data-section="${session.id}"] .dashboard-resize-handle`)?.focus({ preventScroll: true }));
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, id: DashboardSection) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      const pointerId = resizeRef.current?.pointerId;
      cancelResize();
      if (pointerId != null && event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId);
      setAnnouncement('Resize cancelled. Layout unchanged.');
      return;
    }
    const index = gridSizes.indexOf(dashboardSectionSize(preferences, id));
    const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? gridSizes.length - 1 : -1;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const size = gridSizes[next];
    if (size) {
      onChange(resizeDashboardSection(preferences, id, size));
      setAnnouncement(`${dashboardSectionLabels[id]} resized to ${sizeLabels[size]}.`);
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>(`[data-section="${id}"] .dashboard-resize-handle`)?.focus({ preventScroll: true }));
    }
  };

  const rows = dashboardSectionRows(preferences);

  return <>
    {editing && <section className="dashboard-layout-editor" aria-label="Edit dashboard layout">
      <div><strong><GripVertical size={16} aria-hidden />Edit layout</strong></div>
      <div><button type="button" onClick={() => { cancelDrag(); cancelResize(); onChange(resetDashboardLayout(preferences)); setAnnouncement('Original order and widths restored.'); }}>Reset layout</button><button type="button" className="dashboard-layout-done" onClick={() => { cancelDrag(); cancelResize(); onDone(); }}>Done editing</button></div>
    </section>}
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    <div ref={rootRef} className="dashboard-sections" aria-label="Dashboard sections">{rows.map(row => {
      const wide = (id: DashboardSection) => dashboardSectionSize(preferences, id) === 'wide';
      const mixed = row.length === 2 && wide(row[0]) !== wide(row[1]);
      const columns = row.map(id => mixed && wide(id) ? 'minmax(0,2fr)' : 'minmax(0,1fr)').join(' ');
      return <div key={row.join('-')} className="dashboard-section-row" data-count={row.length} style={{ '--dashboard-columns': columns } as CSSProperties}>{row.map(id => {
        const label = dashboardSectionLabels[id];
        const edge = row.indexOf(id) === 1 ? 'left' : 'right';
        const preview = resizing?.id === id ? resizing : null;
        const size = dashboardSectionSize(preferences, id);
        return <div key={id} className="dashboard-panel" data-section={id} data-size={size} data-editing={editing} data-dragging={editing && dragging === id} data-drop-target={editing && dropTarget === id} data-resizing={editing && !!preview}>
          {editing && <div className="dashboard-panel-tools">
            <button type="button" className="dashboard-drag-handle" aria-label={`Move ${label}`} title="Drag to move, or use arrow keys" disabled={visibleIds.length < 2} onPointerDown={event => startDrag(event, id)} onPointerMove={drag} onPointerUp={drop} onPointerCancel={cancelDrag} onLostPointerCapture={() => { if (sessionRef.current) cancelDrag(); }} onKeyDown={event => moveWithKeyboard(event, id)}><GripVertical size={17} aria-hidden /><span>{label}</span></button>
          </div>}
          {sections[id]}
          {editing && <button type="button" role="slider" className="dashboard-resize-handle" data-edge={edge} aria-label={`Resize ${label}`} aria-orientation="horizontal" aria-valuemin={1} aria-valuemax={3} aria-valuenow={gridSizes.indexOf(preview?.size ?? size) + 1} aria-valuetext={sizeLabels[preview?.size ?? size]} title="Drag corner to resize · arrow keys also work" onPointerDown={event => startResize(event, id, edge)} onPointerMove={resize} onPointerUp={finishResize} onPointerCancel={cancelResize} onLostPointerCapture={cancelResize} onKeyDown={event => resizeWithKeyboard(event, id)}>{edge === 'left' ? <MoveDiagonal2 size={16} aria-hidden /> : <MoveDiagonal size={16} aria-hidden />}</button>}
          {editing && preview && <div className="dashboard-resize-preview" data-edge={preview.edge} style={{ width: preview.width }} aria-hidden><span>{sizeLabels[preview.size]}</span></div>}
        </div>;
      })}</div>;
    })}</div>
  </>;
}
