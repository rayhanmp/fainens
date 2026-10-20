import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, KeyRound, Link2, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SCHEMA_AREAS, SCHEMA_TABLES, type SchemaArea, type SchemaTable } from './schema-map';
import { VisualFrame } from './visuals';

/**
 * An entity-relationship diagram of the whole database, one area at a time: every table with all
 * its columns, keys and types, and a line for each foreign key between tables in the area. Links
 * to other areas jump there. Data from schema-map.ts (extracted from the Drizzle schema).
 */

const BY_NAME = new Map(SCHEMA_TABLES.map((table) => [table.name, table]));
/** For each table, the tables whose columns point at it. */
const REFERENCED_BY = SCHEMA_TABLES.reduce<Map<string, Set<string>>>((map, table) => {
  for (const column of table.columns) if (column.references && column.references !== table.name) map.set(column.references, (map.get(column.references) ?? new Set()).add(table.name));
  return map;
}, new Map());

type Wire = { key: string; from: string; to: string; d: string };

export function SchemaDiagram() {
  const [area, setArea] = useState<SchemaArea>('Ledger');
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const [wires, setWires] = useState<Wire[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);

  const searching = query.trim().length > 0;
  const term = query.trim().toLowerCase();
  const tables = useMemo<SchemaTable[]>(() => (searching
    ? SCHEMA_TABLES.filter((table) => table.name.includes(term) || table.columns.some((column) => column.name.includes(term)))
    : SCHEMA_TABLES.filter((table) => table.area === area)), [area, searching, term]);
  const shown = useMemo(() => new Set(tables.map((table) => table.name)), [tables]);

  // Draw the foreign keys between cards on screen, re-measured whenever the layout changes size.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const measure = () => {
      const base = canvas.getBoundingClientRect();
      const next: Wire[] = [];
      for (const table of tables) {
        for (const column of table.columns) {
          if (!column.references || !shown.has(column.references)) continue;
          const row = canvas.querySelector<HTMLElement>(`[data-col="${table.name}.${column.name}"]`);
          const target = canvas.querySelector<HTMLElement>(`[data-table="${column.references}"]`);
          const source = canvas.querySelector<HTMLElement>(`[data-table="${table.name}"]`);
          if (!row || !target || !source) continue;
          const r = row.getBoundingClientRect(); const t = target.getBoundingClientRect(); const s = source.getBoundingClientRect();
          const y1 = r.top + r.height / 2 - base.top;
          const y2 = t.top + 18 - base.top;
          let d: string;
          if (column.references === table.name) {
            const x = s.right - base.left;
            d = `M ${x} ${y1} C ${x + 34} ${y1}, ${x + 34} ${y2}, ${x} ${y2}`;
          } else if (t.left >= s.right - 4) {
            const x1 = s.right - base.left; const x2 = t.left - base.left; const mid = (x1 + x2) / 2;
            d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
          } else if (t.right <= s.left + 4) {
            const x1 = s.left - base.left; const x2 = t.right - base.left; const mid = (x1 + x2) / 2;
            d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
          } else {
            // Same column: loop out to the right and back in.
            const x1 = s.right - base.left; const x2 = t.right - base.left; const out = Math.max(x1, x2) + 30;
            d = `M ${x1} ${y1} C ${out} ${y1}, ${out} ${y2}, ${x2} ${y2}`;
          }
          next.push({ key: `${table.name}.${column.name}`, from: table.name, to: column.references, d });
        }
      }
      setWires(next);
    };
    const observer = new ResizeObserver(() => measure());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [tables, shown]);

  const jump = (name: string) => {
    const table = BY_NAME.get(name);
    if (!table) return;
    setQuery('');
    setArea(table.area);
    setFocus(name);
  };
  const related = (name: string) => focus === null || focus === name || wires.some((wire) => (wire.from === focus && wire.to === name) || (wire.to === focus && wire.from === name));

  return (
    <VisualFrame caption={`The whole database: ${SCHEMA_TABLES.length} tables, ${SCHEMA_TABLES.reduce((sum, table) => sum + table.columns.length, 0)} columns. Choose an area or search; point at a table to trace its keys.`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Schema areas">
          {SCHEMA_AREAS.map((item) => (
            <button key={item} type="button" role="tab" aria-selected={!searching && area === item} onClick={() => { setQuery(''); setArea(item); setFocus(null); }}
              className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition-colors', !searching && area === item ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface)] text-[var(--ref-on-surface-variant)] ring-1 ring-[var(--color-border)] hover:text-[var(--ref-on-surface)]')}>
              {item} <span className="opacity-70">{SCHEMA_TABLES.filter((table) => table.area === item).length}</span>
            </button>
          ))}
        </div>
        <label className="relative block lg:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ref-outline)]" aria-hidden />
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setFocus(null); }} placeholder="Find a table or column" aria-label="Find a table or column"
            className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-3 text-sm outline-none focus:border-[var(--ref-primary)]" />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--ref-on-surface-variant)]">
        <span className="flex items-center gap-1"><KeyRound className="h-3 w-3 text-amber-600" />primary key</span>
        <span className="flex items-center gap-1"><Link2 className="h-3 w-3 text-[var(--color-accent)]" />foreign key</span>
        <span><span className="font-mono">int?</span> nullable</span>
        <span>Lines connect keys within this area; arrows jump to another area.</span>
      </div>

      <div ref={canvasRef} className="relative mt-4" onMouseLeave={() => setFocus(null)}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {wires.map((wire) => {
            const on = focus !== null && (wire.from === focus || wire.to === focus);
            return <path key={wire.key} d={wire.d} fill="none" stroke={on ? 'var(--color-accent)' : 'var(--color-border-strong)'} strokeWidth={on ? 2 : 1.25} opacity={focus === null || on ? 1 : 0.25} className="transition-[stroke,opacity] duration-200" />;
          })}
        </svg>
        {tables.length === 0 && <p className="py-10 text-center text-sm text-[var(--ref-on-surface-variant)]">No table or column matches “{query}”.</p>}
        <div className="relative grid grid-cols-1 items-start gap-x-14 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          {tables.map((table) => (
            <section key={table.name} data-table={table.name} onMouseEnter={() => setFocus(table.name)}
              className={cn('overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-sm ring-1 transition-[opacity,box-shadow] duration-200', focus === table.name ? 'ring-2 ring-[var(--color-accent)]' : 'ring-[var(--color-border)]', !related(table.name) && 'opacity-40')}>
              <header className={cn('flex h-9 items-center justify-between gap-2 px-3', table.area === 'Ledger' ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface)]')}>
                <span className="truncate font-mono text-xs font-bold">{table.name}</span>
                {searching && <span className="shrink-0 text-[10px] opacity-75">{table.area}</span>}
              </header>
              {table.note && <p className="border-b border-[var(--color-border)] px-3 py-1.5 text-[11px] leading-snug text-[var(--ref-on-surface-variant)]">{table.note}</p>}
              <ul className="divide-y divide-[var(--color-border)]/60 font-mono text-[11px]">
                {table.columns.map((column) => {
                  const external = column.references && !shown.has(column.references);
                  const hit = searching && column.name.includes(term);
                  return (
                    <li key={column.name} data-col={`${table.name}.${column.name}`} className={cn('flex items-center gap-1.5 px-3 py-[3px]', hit && 'bg-amber-200/40')}>
                      <span className="grid w-3.5 shrink-0 place-items-center">{column.pk ? <KeyRound className="h-3 w-3 text-amber-600" /> : column.references ? <Link2 className="h-3 w-3 text-[var(--color-accent)]" /> : null}</span>
                      <span className={cn('min-w-0 flex-1 truncate', column.pk ? 'font-bold text-[var(--ref-on-surface)]' : 'text-[var(--ref-on-surface)]')}>{column.name}</span>
                      {external ? (
                        <button type="button" onClick={() => jump(column.references!)} className="flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-semibold text-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]" title={`Go to ${column.references}`}>{column.references}<ArrowUpRight className="h-3 w-3" /></button>
                      ) : column.references ? <span className="shrink-0 text-[10px] text-[var(--color-accent)]">→ {column.references === table.name ? 'self' : column.references}</span> : null}
                      <span className="w-9 shrink-0 text-right text-[var(--ref-on-surface-variant)]">{column.type}{column.notNull ? '' : '?'}</span>
                    </li>
                  );
                })}
              </ul>
              {REFERENCED_BY.get(table.name) && (
                <footer className="flex flex-wrap items-center gap-1 border-t border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-1.5 text-[10px] text-[var(--ref-on-surface-variant)]">
                  <span className="mr-0.5">Referenced by</span>
                  {[...REFERENCED_BY.get(table.name)!].map((name) => (
                    <button key={name} type="button" onClick={() => jump(name)} className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-mono ring-1 ring-[var(--color-border)] hover:text-[var(--color-accent)]">{name}</button>
                  ))}
                </footer>
              )}
            </section>
          ))}
        </div>
      </div>
    </VisualFrame>
  );
}
