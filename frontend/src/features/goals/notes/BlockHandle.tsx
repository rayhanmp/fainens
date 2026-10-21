import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { ArrowDown, ArrowUp, Copy, GripVertical, Heading2, ListChecks, Pilcrow, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';

type Block = { pos: number; top: number };

/** Starts dragging the block at `pos` the way the editor moves a dragged selection. */
function startDrag(view: Editor['view'], pos: number) {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  view.dragging = { slice: view.state.selection.content(), move: true };
}

/**
 * A handle beside the block under the pointer: drag it to move the block, or open it to move the
 * block up or down, duplicate it, turn it into a heading, paragraph or checklist, or delete it.
 */
export function BlockHandle({ editor, frame }: { editor: Editor; frame: RefObject<HTMLDivElement | null> }) {
  const [block, setBlock] = useState<Block | null>(null);
  const [menu, setMenu] = useState(false);
  const handle = useRef<HTMLDivElement>(null);
  const menuOpen = useRef(false);
  useEffect(() => { menuOpen.current = menu; }, [menu]);

  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const onMove = (event: MouseEvent) => {
      if (menuOpen.current || !editor.isEditable) return;
      if (handle.current?.contains(event.target as Node)) return;
      const view = editor.view;
      const area = view.dom.getBoundingClientRect();
      if (event.clientY < area.top || event.clientY > area.bottom) return setBlock(null);
      const hit = view.posAtCoords({ left: area.left + 12, top: event.clientY });
      if (!hit) return;
      const $pos = view.state.doc.resolve(hit.pos);
      const pos = $pos.depth >= 1 ? $pos.before(1) : hit.inside >= 0 ? hit.inside : hit.pos;
      const dom = view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) return;
      setBlock({ pos, top: dom.getBoundingClientRect().top - box.getBoundingClientRect().top });
    };
    const onLeave = () => { if (!menuOpen.current) setBlock(null); };
    box.addEventListener('mousemove', onMove);
    box.addEventListener('mouseleave', onLeave);
    return () => {
      box.removeEventListener('mousemove', onMove);
      box.removeEventListener('mouseleave', onLeave);
    };
  }, [editor, frame]);

  if (!block) return null;
  const doc = editor.state.doc;
  const node = doc.nodeAt(block.pos);
  if (!node) return null;
  const index = doc.resolve(block.pos).index(0);

  const run = (change: () => void) => {
    change();
    setMenu(false);
    setBlock(null);
  };
  const move = (step: -1 | 1) => run(() => {
    const neighbour = doc.maybeChild(index + step);
    if (!neighbour) return;
    const tr = editor.state.tr.delete(block.pos, block.pos + node.nodeSize);
    const to = step < 0 ? block.pos - neighbour.nodeSize : block.pos + neighbour.nodeSize;
    editor.view.dispatch(tr.insert(to, node).scrollIntoView());
  });
  const items = [
    { label: 'Move up', icon: ArrowUp, disabled: index === 0, run: () => move(-1) },
    { label: 'Move down', icon: ArrowDown, disabled: index >= doc.childCount - 1, run: () => move(1) },
    { label: 'Duplicate', icon: Copy, run: () => run(() => editor.view.dispatch(editor.state.tr.insert(block.pos + node.nodeSize, node.copy(node.content)))) },
    { label: 'Turn into text', icon: Pilcrow, disabled: node.type.name !== 'heading', run: () => run(() => editor.chain().focus().setTextSelection(block.pos + 1).setParagraph().run()) },
    { label: 'Turn into heading', icon: Heading2, disabled: node.type.name !== 'paragraph', run: () => run(() => editor.chain().focus().setTextSelection(block.pos + 1).setNode('heading', { level: 2 }).run()) },
    { label: 'Turn into checklist', icon: ListChecks, disabled: node.type.name !== 'paragraph' && node.type.name !== 'bulletList', run: () => run(() => editor.chain().focus().setTextSelection(block.pos + (node.type.name === 'bulletList' ? 3 : 1)).toggleTaskList().run()) },
    { label: 'Delete', icon: Trash2, danger: true, run: () => run(() => editor.view.dispatch(editor.state.tr.delete(block.pos, block.pos + node.nodeSize))) },
  ];

  return (
    <div ref={handle} className="absolute left-0 z-20" style={{ top: block.top }}>
      <button
        type="button"
        draggable
        aria-label="Move or change this block"
        aria-expanded={menu}
        title="Drag to move, click for more"
        onClick={() => setMenu((open) => !open)}
        onDragStart={(event) => {
          startDrag(editor.view, block.pos);
          const dom = editor.view.nodeDOM(block.pos);
          if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0);
          event.dataTransfer.setData('text/plain', node.textContent);
          event.dataTransfer.effectAllowed = 'move';
        }}
        className="grid h-6 w-5 cursor-grab place-items-center rounded text-[var(--ref-outline)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-on-surface-variant)] active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      {menu && (
        <ul role="menu" className="absolute left-6 top-0 z-30 w-48 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] py-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
          {/* Only what applies to this block; moving stays, greyed out at the ends. */}
          {items.filter((item) => !item.disabled || item.label.startsWith('Move')).map(({ label, icon: Icon, disabled, danger, run: action }) => (
            <li key={label} role="none">
              <button type="button" role="menuitem" disabled={disabled} onClick={action} className={cn('flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-[var(--ref-surface-container-low)] disabled:opacity-40', danger ? 'text-[var(--color-danger)]' : 'text-[var(--ref-on-surface)]')}>
                <Icon className="h-4 w-4" aria-hidden />{label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
