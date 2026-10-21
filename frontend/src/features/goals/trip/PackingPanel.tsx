import { useMemo, useState } from 'react';
import { ChevronDown, GripVertical, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../components/ui/useToast';
import { cn } from '../../../lib/utils';
import { Segmented } from '../../savings/fields';
import { Dropdown } from '../../settings/controls';
import { Section } from '../../subscriptions/PageParts';
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  BAG_LABELS,
  CATEGORY_LABELS,
  DEFAULT_BAG,
  guessCategory,
  PACKING_BAGS,
  PACKING_CATEGORIES,
  starterList,
  type Activity,
  type PackingBag,
  type PackingCategory,
} from './packing';
import { useAddPackingMutation, useDeletePackingMutation, useMovePackingMutation, useUpdatePackingMutation, type PackingItem, type Trip } from './queries';
import { tripLength } from './trip-utils';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
type Who = 'all' | 'shared' | number;
type Lane = PackingBag | 'none';
const LANES: Lane[] = [...PACKING_BAGS, 'none'];
const laneLabel = (lane: Lane) => (lane === 'none' ? 'Not in a bag yet' : BAG_LABELS[lane]);
const laneOf = (item: PackingItem): Lane => item.bag ?? 'none';
const byOrder = (a: PackingItem, b: PackingItem) => a.sortOrder - b.sortOrder || a.id - b.id;

/** One thing to pack: tick it, open it to change what it is, how many, its kind, bag and owner. */
function ItemRow({ item, trip, showOwner, showBag, draggable, dragging, dropBefore, onDragStart, onDragEnd, onDragOver }: {
  item: PackingItem;
  trip: Trip;
  showOwner: boolean;
  showBag: boolean;
  draggable: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: () => void;
}) {
  const update = useUpdatePackingMutation();
  const remove = useDeletePackingMutation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const owner = item.travellerId === null ? null : trip.travellers.find((traveller) => traveller.id === item.travellerId);
  const save = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch, { onError: (error) => toast.error(errorText(error, 'Could not save')) });

  if (editing) {
    return (
      <li className="my-1 space-y-2 rounded-xl bg-[var(--ref-surface-container-low)] p-2.5">
        <div className="flex gap-2">
          <input aria-label="What" autoFocus className="brutalist-input h-[34px] min-w-0 flex-1" value={text} maxLength={120} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setEditing(false); }} />
          <input aria-label="How many" inputMode="numeric" className="brutalist-input h-[34px] w-[64px] text-center tabular-nums" value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/\D/g, '').slice(0, 2))} />
        </div>
        <div className="grid grid-cols-1 gap-2 @md:grid-cols-3">
          <Dropdown ariaLabel="Kind" value={item.category} options={PACKING_CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] }))} onChange={(category) => save({ id: item.id, category })} />
          <Dropdown ariaLabel="Bag" value={item.bag ?? 'none'} options={LANES.map((lane) => ({ value: lane, label: laneLabel(lane) }))} onChange={(lane) => save({ id: item.id, bag: lane === 'none' ? null : lane })} />
          <Dropdown ariaLabel="Whose" value={String(item.travellerId ?? 'shared')} options={[{ value: 'shared', label: 'Everyone’s' }, ...trip.travellers.map((traveller) => ({ value: String(traveller.id), label: traveller.name }))]} onChange={(value) => save({ id: item.id, travellerId: value === 'shared' ? null : Number(value) })} />
        </div>
        <div className="flex items-center justify-between">
          <button type="button" aria-label={`Remove ${item.text}`} onClick={() => remove.mutate(item.id, { onError: (error) => toast.error(errorText(error, 'Could not remove it')) })} className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)]"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
          <span className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>Close</Button>
            <Button type="button" size="sm" disabled={!text.trim()} onClick={() => { save({ id: item.id, text: text.trim(), quantity: Math.max(1, Number(quantity) || 1) }); setEditing(false); }}>Save</Button>
          </span>
        </div>
      </li>
    );
  }

  return (
    <li
      draggable={draggable}
      onDragStart={(event) => { event.dataTransfer.setData('text/plain', String(item.id)); event.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => { if (!onDragOver) return; event.preventDefault(); event.stopPropagation(); onDragOver(); }}
      className={cn('group relative flex items-center gap-2 rounded-lg py-1.5 pr-1', draggable && 'bg-[var(--color-surface)]', dragging && 'opacity-40', dropBefore && 'before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:rounded-full before:bg-[var(--ref-primary)]')}
    >
      {draggable && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-[var(--ref-outline)] opacity-60 group-hover:opacity-100" aria-hidden />}
      <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--ref-primary)]" checked={item.done} aria-label={item.text} onChange={(event) => save({ id: item.id, done: event.target.checked })} />
      <button type="button" onClick={() => { setText(item.text); setQuantity(String(item.quantity)); setEditing(true); }} className="min-w-0 flex-1 text-left">
        <span className={cn('text-sm', item.done ? 'text-[var(--ref-on-surface-variant)] line-through' : 'text-[var(--ref-on-surface)]')}>
          {item.text}
          {item.quantity > 1 && <span className="ml-1.5 text-xs font-semibold tabular-nums text-[var(--ref-on-surface-variant)]">×{item.quantity}</span>}
        </span>
      </button>
      {showBag && <span className="shrink-0 text-[11px] text-[var(--ref-on-surface-variant)]">{item.bag ? BAG_LABELS[item.bag] : ''}</span>}
      {showOwner && <span className="shrink-0 rounded-full bg-[var(--ref-surface-container-high)] px-2 py-px text-[11px] font-medium text-[var(--ref-on-surface-variant)]">{owner ? owner.name : 'Everyone'}</span>}
    </li>
  );
}

/** Builds a starter list from the weather, how long the trip is and what you'll do; only what's missing is added. */
function Starter({ goalId, trip, onDone }: { goalId: number; trip: Trip; onDone?: () => void }) {
  const add = useAddPackingMutation();
  const [climate, setClimate] = useState<'cold' | 'warm' | 'mixed'>(trip.basics.climate ?? 'warm');
  const [activities, setActivities] = useState<Activity[]>(['city']);
  const [days, setDays] = useState(String(tripLength(trip.basics) || 7));
  const items = starterList({ climate, activities, days: Number(days) || 1, travellers: trip.travellers, existing: trip.packing });
  const toggle = (activity: Activity) => setActivities((current) => (current.includes(activity) ? current.filter((item) => item !== activity) : [...current, activity]));

  return (
    <div className="rounded-xl bg-[var(--ref-surface-container-low)] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ref-on-surface)]"><Sparkles className="h-4 w-4 text-[var(--ref-primary)]" aria-hidden />A list for this trip</p>
      <p className="mt-1 text-xs text-[var(--ref-on-surface-variant)]">{trip.travellers.length ? 'Each person gets their own things, and the group shares the rest.' : 'Add who’s going first to give each person their own list.'} Amounts follow the days: a pair of socks a day, tops to wear twice.</p>
      <div className="settings-compact mt-3 grid grid-cols-1 gap-3 @lg:grid-cols-[minmax(0,1fr)_90px]">
        <Segmented ariaLabel="Weather" value={climate} onChange={setClimate} options={[{ value: 'cold', label: 'Cold' }, { value: 'warm', label: 'Warm' }, { value: 'mixed', label: 'Some of each' }]} />
        <label className="flex items-center gap-2 text-xs text-[var(--ref-on-surface-variant)]">
          <input aria-label="Days" inputMode="numeric" className="brutalist-input h-[34px] w-[52px] text-center tabular-nums" value={days} onChange={(event) => setDays(event.target.value.replace(/\D/g, '').slice(0, 2))} />
          days
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="What you’ll do">
        {ACTIVITIES.map((activity) => (
          <button key={activity} type="button" aria-pressed={activities.includes(activity)} onClick={() => toggle(activity)} className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors', activities.includes(activity) ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'border-[var(--color-border)] text-[var(--ref-on-surface-variant)] hover:bg-[var(--color-surface)]')}>
            {ACTIVITY_LABELS[activity]}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {onDone && <Button type="button" size="sm" variant="secondary" onClick={onDone}>Cancel</Button>}
        <Button type="button" size="sm" isLoading={add.isPending} disabled={!items.length} onClick={() => add.mutate({ goalId, items }, { onSuccess: () => onDone?.(), onError: (error) => toast.error(errorText(error, 'Could not add the list')) })}>
          {items.length ? `Add ${items.length} thing${items.length === 1 ? '' : 's'}` : 'It’s all on the list'}
        </Button>
      </div>
    </div>
  );
}

/** Adds one thing: its kind is guessed from the name and it goes in that kind's usual bag. */
function QuickAdd({ goalId, trip, who }: { goalId: number; trip: Trip; who: Who }) {
  const add = useAddPackingMutation();
  const [text, setText] = useState('');
  const [owner, setOwner] = useState<string>(typeof who === 'number' ? String(who) : 'shared');
  const category = guessCategory(text);
  const submit = () => {
    const name = text.trim();
    if (!name) return;
    const [, count] = name.match(/\s[x×](\d{1,2})$/i) ?? [];
    add.mutate({ goalId, items: [{ text: count ? name.replace(/\s[x×]\d{1,2}$/i, '') : name, category, quantity: count ? Number(count) : 1, bag: DEFAULT_BAG[category], travellerId: owner === 'shared' ? null : Number(owner) }] }, {
      onSuccess: () => setText(''),
      onError: (error) => toast.error(errorText(error, 'Could not add it')),
    });
  };
  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="settings-compact flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <input aria-label="Add something to pack" className="brutalist-input h-[34px] w-full pr-28" placeholder="Add something, like “socks x7”" value={text} maxLength={120} onChange={(event) => setText(event.target.value)} />
        {text.trim() && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-[var(--ref-surface-container-high)] px-2 py-px text-[11px] text-[var(--ref-on-surface-variant)]">{CATEGORY_LABELS[category]}</span>}
      </div>
      {trip.travellers.length > 0 && (
        <div className="w-[150px]"><Dropdown ariaLabel="Whose" value={owner} options={[{ value: 'shared', label: 'Everyone’s' }, ...trip.travellers.map((traveller) => ({ value: String(traveller.id), label: traveller.name }))]} onChange={setOwner} /></div>
      )}
      <Button type="submit" size="sm" variant="secondary" isLoading={add.isPending} disabled={!text.trim()}>Add</Button>
    </form>
  );
}

/**
 * What to pack, two ways: by bag (carry-on, checked, a personal item, not decided yet), dragging
 * things between them, or by kind (clothes, toiletries, documents…). Show everyone's or one
 * person's; tick things off as they go in. A starter list fits the weather, the days and what
 * you'll do.
 */
export function PackingPanel({ goalId, trip }: { goalId: number; trip: Trip }) {
  const move = useMovePackingMutation(goalId);
  const [view, setView] = useState<'bag' | 'kind'>('bag');
  const [who, setWho] = useState<Who>('all');
  const [starting, setStarting] = useState(false);
  const [folded, setFolded] = useState<Set<PackingCategory>>(new Set());
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<{ lane: Lane; before: number | null } | null>(null);
  const items = useMemo(() => trip.packing.filter((item) => who === 'all' || (who === 'shared' ? item.travellerId === null : item.travellerId === who)).sort(byOrder), [trip.packing, who]);
  const packed = items.filter((item) => item.done).length;
  const showOwner = who === 'all' && trip.travellers.length > 0;

  const drop = (lane: Lane) => {
    if (dragged === null || !over) return;
    const order = items.filter((item) => laneOf(item) === lane && item.id !== dragged).map((item) => item.id);
    const at = over.before === null ? order.length : Math.max(0, order.indexOf(over.before));
    order.splice(at, 0, dragged);
    move.mutate({ bag: lane === 'none' ? null : lane, ids: order }, { onError: (error) => toast.error(errorText(error, 'Could not move it')) });
    setDragged(null);
    setOver(null);
  };

  const rowProps = (item: PackingItem, lane?: Lane) => ({
    item,
    trip,
    showOwner,
    showBag: !lane,
    draggable: Boolean(lane),
    dragging: dragged === item.id,
    dropBefore: Boolean(lane) && dragged !== null && dragged !== item.id && over?.before === item.id,
    onDragStart: lane ? () => setDragged(item.id) : undefined,
    onDragEnd: lane ? () => { setDragged(null); setOver(null); } : undefined,
    onDragOver: lane ? () => { if (over?.before !== item.id) setOver({ lane, before: item.id }); } : undefined,
  });

  return (
    <Section
      title="Packing"
      aside={trip.packing.length > 0 ? <Segmented ariaLabel="Show by" value={view} onChange={setView} options={[{ value: 'bag', label: 'By bag' }, { value: 'kind', label: 'By kind' }]} /> : undefined}
    >
      <div className="@container space-y-4 px-4 py-4 sm:px-5">
        {trip.packing.length === 0 ? (
          <Starter goalId={goalId} trip={trip} />
        ) : (
          <>
            {/* Whose things, and how many are in. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Whose things">
                {([['all', 'Everyone'], ...trip.travellers.map((traveller) => [traveller.id, traveller.name]), ...(trip.travellers.length ? [['shared', 'Shared']] : [])] as Array<[Who, string]>).map(([value, label]) => (
                  <button key={String(value)} type="button" aria-pressed={who === value} onClick={() => setWho(value)} className={cn('rounded-full px-3 py-1 text-xs font-semibold transition-colors', who === value ? 'bg-[var(--ref-primary)] text-[var(--color-surface)]' : 'bg-[var(--ref-surface-container-low)] text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)]')}>{label}</button>
                ))}
              </div>
              <span className="text-xs font-semibold tabular-nums text-[var(--ref-on-surface-variant)]">{packed} of {items.length} packed</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ref-surface-container-high)]" aria-hidden>
              <div className="h-full rounded-full bg-[var(--ref-primary)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${items.length ? (packed / items.length) * 100 : 0}%` }} />
            </div>

            <QuickAdd key={String(who)} goalId={goalId} trip={trip} who={who} />

            {view === 'bag' ? (
              <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
                {LANES.map((lane) => {
                  const inLane = items.filter((item) => laneOf(item) === lane);
                  const done = inLane.filter((item) => item.done).length;
                  return (
                    <div
                      key={lane}
                      onDragOver={(event) => { if (dragged === null) return; event.preventDefault(); if (over?.lane !== lane || over.before !== null) setOver({ lane, before: null }); }}
                      onDrop={(event) => { event.preventDefault(); drop(lane); }}
                      className={cn('rounded-xl border p-2.5 transition-colors', dragged !== null && over?.lane === lane ? 'border-[var(--ref-primary)] bg-[var(--ref-primary)]/5' : 'border-[var(--color-border)] bg-[var(--ref-surface-container-low)]')}
                    >
                      <p className="flex items-center justify-between px-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">
                        <span>{laneLabel(lane)}</span>
                        {inLane.length > 0 && <span className="tabular-nums tracking-normal">{done}/{inLane.length}</span>}
                      </p>
                      {inLane.length === 0
                        ? <p className="rounded-lg border border-dashed border-[var(--color-border)] px-2 py-3 text-center text-xs text-[var(--ref-on-surface-variant)]">Drag things here</p>
                        : <ul className="space-y-0.5">{inLane.map((item) => <ItemRow key={item.id} {...rowProps(item, lane)} />)}</ul>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {PACKING_CATEGORIES.map((category) => {
                  const inKind = items.filter((item) => item.category === category);
                  if (!inKind.length) return null;
                  const isFolded = folded.has(category);
                  return (
                    <div key={category} className="py-2">
                      <button type="button" aria-expanded={!isFolded} onClick={() => setFolded((current) => { const next = new Set(current); if (next.has(category)) next.delete(category); else next.add(category); return next; })} className="flex w-full items-center justify-between py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ref-on-surface-variant)]">
                        <span className="flex items-center gap-1"><ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isFolded && '-rotate-90')} aria-hidden />{CATEGORY_LABELS[category]}</span>
                        <span className="tabular-nums tracking-normal">{inKind.filter((item) => item.done).length}/{inKind.length}</span>
                      </button>
                      {!isFolded && <ul className="mt-1">{inKind.map((item) => <ItemRow key={item.id} {...rowProps(item)} />)}</ul>}
                    </div>
                  );
                })}
              </div>
            )}

            {starting
              ? <Starter goalId={goalId} trip={trip} onDone={() => setStarting(false)} />
              : <button type="button" onClick={() => setStarting(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ref-primary)] hover:underline"><Sparkles className="h-3.5 w-3.5" aria-hidden />Add more from a list for this trip</button>}
          </>
        )}
      </div>
    </Section>
  );
}
