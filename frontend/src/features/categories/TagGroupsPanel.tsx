import { useState, type DragEvent, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, FolderPlus, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { errorMessage, toast } from '../../components/ui/useToast';
import { cn } from '../../lib/utils';
import { ActionSheet } from '../../components/ui/ActionSheet';
import { usePhoneSheets } from '../../hooks/usePhoneSheets';
import { useCreateTagGroupMutation, useDeleteTagGroupMutation, useMoveTagMutation, useUpdateTagGroupMutation } from './queries';

export type PanelTag = { id: number; name: string; color: string; groupId?: number | null };
export type PanelTagGroup = { id: number; name: string; sortOrder: number };

const DRAG_TYPE = 'application/x-fainens-tag';

/**
 * Tags filed into groups you make yourself. Drag a tag onto a group (or onto "Ungrouped") to move
 * it; groups are only for keeping the list tidy and never affect reports.
 */
export function TagGroupsPanel({ tags, groups, uses, loading, className, onOpenTag, onAddTag }: {
  tags: PanelTag[];
  groups: PanelTagGroup[];
  uses: (tagId: number) => number;
  loading: boolean;
  className?: string;
  /** Shows the tag's entries; editing is offered from there. */
  onOpenTag: (tag: PanelTag) => void;
  onAddTag: () => void;
}) {
  const { confirm } = useConfirm();
  const moveTag = useMoveTagMutation();
  const createGroup = useCreateTagGroupMutation();
  const updateGroup = useUpdateTagGroupMutation();
  const deleteGroup = useDeleteTagGroupMutation();
  const [dropTarget, setDropTarget] = useState<number | 'none' | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [menuGroupId, setMenuGroupId] = useState<number | null>(null);
  const asSheet = usePhoneSheets();

  const orderedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const known = new Set(orderedGroups.map((group) => group.id));
  const menuGroupIndex = orderedGroups.findIndex((group) => group.id === menuGroupId);
  const menuGroup = menuGroupIndex >= 0 ? orderedGroups[menuGroupIndex] : null;
  const nameCounts = tags.reduce<Record<string, number>>((counts, tag) => ({ ...counts, [tag.name.trim().toLowerCase()]: (counts[tag.name.trim().toLowerCase()] ?? 0) + 1 }), {});
  const tagsIn = (groupId: number | null) => tags
    .filter((tag) => (groupId == null ? tag.groupId == null || !known.has(tag.groupId) : tag.groupId === groupId))
    .sort((a, b) => uses(b.id) - uses(a.id) || a.name.localeCompare(b.name));

  const drop = (groupId: number | null) => (event: DragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    const id = Number(event.dataTransfer.getData(DRAG_TYPE));
    const tag = tags.find((item) => item.id === id);
    if (!tag || (tag.groupId ?? null) === groupId) return;
    moveTag.mutate({ id, groupId }, { onError: (error) => toast.error('Could not move the tag', errorMessage(error)) });
  };
  const dropZone = (key: number | 'none', groupId: number | null) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: drop(groupId),
  });

  const submitNewGroup = async (event: FormEvent) => {
    event.preventDefault();
    const name = newGroupName?.trim();
    if (!name) return setNewGroupName(null);
    try {
      await createGroup.mutateAsync(name);
      setNewGroupName(null);
    } catch (error) { toast.error('Could not create the group', errorMessage(error)); }
  };
  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renaming) return;
    const name = renaming.name.trim();
    try {
      if (name) await updateGroup.mutateAsync({ id: renaming.id, data: { name } });
      setRenaming(null);
    } catch (error) { toast.error('Could not rename the group', errorMessage(error)); }
  };
  const moveGroup = async (index: number, direction: -1 | 1) => {
    const a = orderedGroups[index];
    const b = orderedGroups[index + direction];
    if (!a || !b) return;
    try {
      // Swap positions; normalise first so equal sort orders can still swap.
      await Promise.all(orderedGroups.map((group, position) => {
        const target = group.id === a.id ? index + direction : group.id === b.id ? index : position;
        return group.sortOrder === target ? null : updateGroup.mutateAsync({ id: group.id, data: { sortOrder: target } });
      }));
    } catch (error) { toast.error('Could not reorder the groups', errorMessage(error)); }
  };
  const removeGroup = async (group: PanelTagGroup) => {
    const count = tagsIn(group.id).length;
    if (!await confirm({ title: 'Delete group', message: `Delete "${group.name}"? ${count > 0 ? `Its ${count} tag${count === 1 ? '' : 's'} stay and become ungrouped.` : 'It has no tags.'}`, confirmLabel: 'Delete group', variant: 'danger' })) return;
    try { await deleteGroup.mutateAsync(group.id); } catch (error) { toast.error('Could not delete the group', errorMessage(error)); }
  };

  const chip = (tag: PanelTag) => {
    const count = uses(tag.id);
    const duplicate = (nameCounts[tag.name.trim().toLowerCase()] ?? 0) > 1;
    return (
      <button
        key={tag.id}
        type="button"
        draggable
        onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, String(tag.id)); event.dataTransfer.effectAllowed = 'move'; setDraggingId(tag.id); }}
        onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
        onClick={() => onOpenTag(tag)}
        title={duplicate ? 'Another tag has the same name' : 'Drag to another group, or click to see its entries'}
        className={cn(
          'inline-flex max-w-full cursor-grab items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-[background-color,opacity] hover:bg-[var(--ref-surface-container-low)] active:cursor-grabbing',
          count === 0 ? 'border-dashed border-[var(--color-border)] text-[var(--ref-on-surface-variant)]' : 'border-[var(--color-border)] text-[var(--ref-on-surface)]',
          draggingId === tag.id && 'opacity-40',
        )}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />
        <span className="truncate">{tag.name}</span>
        {duplicate && <span className="text-[10px] font-semibold text-[var(--color-warning)]">dup</span>}
        {count > 0 && <span className="tabular-nums text-[var(--ref-on-surface-variant)]">{count}</span>}
      </button>
    );
  };

  const section = (key: number | 'none', title: React.ReactNode, groupTags: PanelTag[], actions?: React.ReactNode) => (
    <div
      key={key}
      {...dropZone(key, key === 'none' ? null : key)}
      className={cn('rounded-xl border border-transparent p-2 transition-colors', dropTarget === key && 'border-[var(--ref-primary)] bg-[color-mix(in_srgb,var(--ref-primary)_6%,transparent)]')}
    >
      <div className="mb-1.5 flex min-h-7 items-center gap-1.5 px-0.5">
        {title}
        <span className="text-[11px] tabular-nums text-[var(--ref-on-surface-variant)]">{groupTags.length}</span>
        <div className="ml-auto">{actions}</div>
      </div>
      {groupTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">{groupTags.map(chip)}</div>
      ) : (
        <p className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2.5 text-center text-xs text-[var(--ref-on-surface-variant)]">Drop tags here</p>
      )}
    </div>
  );

  return (
    <aside className={cn('rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)]', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--ref-on-surface)]">Tags</h2>
          {/* Touch screens can't drag tags; there the group is changed in the tag's editor. */}
          <p className="text-xs text-[var(--ref-on-surface-variant)]">
            <span className="pointer-coarse:hidden">Drag tags between groups.</span>
            <span className="hidden pointer-coarse:inline">Tap a tag for its entries; change its group when editing it.</span>
            {' '}Groups don't affect reports.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => setNewGroupName('')} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)]" aria-label="New group" title="New group">
            <FolderPlus className="h-4 w-4" />
          </button>
          <button type="button" onClick={onAddTag} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)] hover:text-[var(--ref-on-surface)]" aria-label="Add tag" title="Add tag">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="space-y-1 p-2">
        {loading ? (
          <p className="px-3 py-4 text-sm text-[var(--ref-on-surface-variant)]">Loading tags…</p>
        ) : (
          <>
            {orderedGroups.map((group, index) => section(
              group.id,
              renaming?.id === group.id ? (
                <form onSubmit={submitRename} className="min-w-0 flex-1">
                  <input
                    autoFocus
                    value={renaming.name}
                    onChange={(event) => setRenaming({ id: group.id, name: event.target.value })}
                    onBlur={submitRename}
                    onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }}
                    aria-label="Group name"
                    className="w-full rounded-md bg-[var(--ref-surface-container-low)] px-2 py-1 text-xs font-semibold uppercase tracking-wider outline-none ring-[var(--ref-primary)] focus:ring-2"
                  />
                </form>
              ) : (
                <span className="flex min-w-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ref-on-surface)]">
                  <GripVertical className="h-3 w-3 shrink-0 text-[var(--ref-outline)]" aria-hidden />
                  <span className="truncate">{group.name}</span>
                </span>
              ),
              tagsIn(group.id),
              <div className="relative">
                <button type="button" onClick={() => setMenuGroupId(menuGroupId === group.id ? null : group.id)} className="grid h-7 w-7 place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)]" aria-label={`Actions for ${group.name}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuGroupId === group.id && !asSheet && (
                  <>
                    <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenuGroupId(null)} />
                    <div className="ui-popover absolute right-0 top-full z-20 mt-1 min-w-[150px] rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1 shadow-xl">
                      {[
                        { label: 'Rename', icon: Pencil, run: () => setRenaming({ id: group.id, name: group.name }), show: true },
                        { label: 'Move up', icon: ArrowUp, run: () => void moveGroup(index, -1), show: index > 0 },
                        { label: 'Move down', icon: ArrowDown, run: () => void moveGroup(index, 1), show: index < orderedGroups.length - 1 },
                      ].filter((item) => item.show).map((item) => (
                        <button key={item.label} type="button" onClick={() => { setMenuGroupId(null); item.run(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-[var(--ref-surface-container-low)]">
                          <item.icon className="h-3.5 w-3.5 text-[var(--ref-on-surface-variant)]" />{item.label}
                        </button>
                      ))}
                      <button type="button" onClick={() => { setMenuGroupId(null); void removeGroup(group); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10">
                        <Trash2 className="h-3.5 w-3.5" />Delete group
                      </button>
                    </div>
                  </>
                )}
              </div>,
            ))}
            {newGroupName != null && (
              <form onSubmit={submitNewGroup} className="flex items-center gap-2 p-2">
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Escape') setNewGroupName(null); }}
                  placeholder="Group name, e.g. Trips"
                  aria-label="New group name"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-3 py-1.5 text-sm outline-none ring-[var(--ref-primary)] focus:ring-2"
                />
                <button type="submit" disabled={createGroup.isPending} className="rounded-lg bg-[var(--ref-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">Add</button>
              </form>
            )}
            {/* Shown while dragging too, so a tag can always be taken back out of a group. */}
            {(tagsIn(null).length > 0 || orderedGroups.length === 0 || draggingId != null) && section(
              'none',
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ref-on-surface-variant)]">{orderedGroups.length > 0 ? 'Ungrouped' : 'All tags'}</span>,
              tagsIn(null),
            )}
            {tags.length === 0 && <p className="px-3 py-2 text-sm text-[var(--ref-on-surface-variant)]">No tags yet. Add tags to label trips, work, reimbursements and so on.</p>}
          </>
        )}
      </div>
      {/* Phones get a group's ⋯ menu as a bottom sheet. */}
      {asSheet && menuGroup && (
        <ActionSheet
          isOpen
          onClose={() => setMenuGroupId(null)}
          title={menuGroup.name}
          actions={[
            { key: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setRenaming({ id: menuGroup.id, name: menuGroup.name }) },
            ...(menuGroupIndex > 0 ? [{ key: 'up', label: 'Move up', icon: ArrowUp, onSelect: () => void moveGroup(menuGroupIndex, -1) }] : []),
            ...(menuGroupIndex < orderedGroups.length - 1 ? [{ key: 'down', label: 'Move down', icon: ArrowDown, onSelect: () => void moveGroup(menuGroupIndex, 1) }] : []),
            { key: 'delete', label: 'Delete group', icon: Trash2, tone: 'danger', onSelect: () => void removeGroup(menuGroup) },
          ]}
        />
      )}
    </aside>
  );
}
