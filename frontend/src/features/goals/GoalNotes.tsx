import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { BubbleMenu, EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { Bold, Check, ExternalLink, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, Minus, Quote, Strikethrough } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Section } from '../subscriptions/PageParts';

const MAX_LENGTH = 20_000;
const SAVE_AFTER_MS = 700;

type Chain = ReturnType<Editor['chain']>;
type SlashItem = { key: string; label: string; hint: string; icon: ComponentType<{ className?: string }>; run: (chain: Chain) => Chain };

/** What `/` offers on an empty line or after a space: blocks to turn the line into. */
const SLASH_ITEMS: SlashItem[] = [
  { key: 'heading', label: 'Heading', hint: 'A section title', icon: Heading2, run: (chain) => chain.setNode('heading', { level: 2 }) },
  { key: 'subheading', label: 'Small heading', hint: 'A smaller title', icon: Heading3, run: (chain) => chain.setNode('heading', { level: 3 }) },
  { key: 'checklist', label: 'Checklist', hint: 'Things to do, ticked as you go', icon: ListChecks, run: (chain) => chain.toggleTaskList() },
  { key: 'bullets', label: 'Bulleted list', hint: 'A simple list', icon: List, run: (chain) => chain.toggleBulletList() },
  { key: 'numbers', label: 'Numbered list', hint: 'Steps in order', icon: ListOrdered, run: (chain) => chain.toggleOrderedList() },
  { key: 'quote', label: 'Quote', hint: 'Set a line apart', icon: Quote, run: (chain) => chain.toggleBlockquote() },
  { key: 'divider', label: 'Divider', hint: 'A line between parts', icon: Minus, run: (chain) => chain.setHorizontalRule() },
];

/** A starting outline for an empty page. */
const OUTLINE = '## Why\n\n\n\n## The plan\n\n- [ ] \n\n## Links\n\n';

type SlashState = { query: string; from: number; to: number; left: number; top: number; index: number };

/** The block menu's width, to keep it inside the notes. */
const MENU_WIDTH = 256;

const markdownOf = (editor: Editor): string => (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown();

/**
 * A goal's notes, written straight on the page: markdown shortcuts format as you type (## for a
 * heading, - [ ] for a checklist, **bold**), `/` offers blocks, selecting text shows a small
 * toolbar, and every change saves by itself. Stored as markdown.
 */
export function GoalNotes({ value, onSave }: { value: string | null; onSave: (next: string | null) => Promise<void> }) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [empty, setEmpty] = useState(!value?.trim());
  const [linking, setLinking] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  const lastSaved = useRef(value ?? '');
  const timer = useRef<number | null>(null);
  const saveRef = useRef(onSave);
  useEffect(() => { saveRef.current = onSave; }, [onSave]);

  const updateSlash = (next: SlashState | null) => {
    slashRef.current = next;
    setSlash(next);
  };

  const flush = useCallback(async (editor: Editor) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const markdown = markdownOf(editor).trim();
    if (markdown === lastSaved.current.trim()) return;
    if (markdown.length > MAX_LENGTH) {
      setStatus('error');
      return;
    }
    setStatus('saving');
    try {
      await saveRef.current(markdown ? markdown : null);
      lastSaved.current = markdown;
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }, []);

  // Watches the text before the cursor for `/word`, to show and filter the block menu.
  const watchSlash = (editor: Editor) => {
    const { state, view } = editor;
    const { $from, empty: collapsed } = state.selection;
    if (!collapsed || !$from.parent.isTextblock || $from.parent.type.name === 'codeBlock') return updateSlash(null);
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
    const match = /(?:^|\s)\/([a-z ]{0,20})$/i.exec(before);
    if (!match) return updateSlash(null);
    const query = match[1] ?? '';
    const coords = view.coordsAtPos($from.pos);
    const box = frame.current?.getBoundingClientRect();
    const current = slashRef.current;
    updateSlash({
      query,
      from: $from.pos - query.length - 1,
      to: $from.pos,
      left: box ? Math.max(0, Math.min(coords.left - box.left, box.width - MENU_WIDTH)) : 0,
      top: box ? coords.bottom - box.top + 6 : 0,
      index: current && current.query === query ? current.index : 0,
    });
  };

  const choose = (editor: Editor, item: SlashItem) => {
    const state = slashRef.current;
    if (!state) return;
    item.run(editor.chain().focus().deleteRange({ from: state.from, to: state.to })).run();
    updateSlash(null);
  };

  const matches = (query: string) => SLASH_ITEMS.filter((item) => `${item.label} ${item.key}`.toLowerCase().includes(query.trim().toLowerCase()));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, code: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noreferrer noopener', target: '_blank' } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Write the plan, a checklist, links… Type / for headings and lists.') }),
      Markdown.configure({ html: false, tightLists: true, linkify: true, transformPastedText: true }),
    ],
    content: value ?? '',
    editorProps: {
      attributes: { class: 'goal-notes-editor', 'aria-label': 'Notes' },
      handleKeyDown: (_view, event) => {
        const state = slashRef.current;
        const current = editorRef.current;
        if (!state || !current) return false;
        const list = matches(state.query);
        if (event.key === 'Escape') {
          updateSlash(null);
          return true;
        }
        if (!list.length) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          updateSlash({ ...state, index: (state.index + step + list.length) % list.length });
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          choose(current, list[Math.min(state.index, list.length - 1)]!);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      setEmpty(current.isEmpty);
      watchSlash(current);
      setStatus('idle');
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(current), SAVE_AFTER_MS);
    },
    onSelectionUpdate: ({ editor: current }) => watchSlash(current),
    onBlur: ({ editor: current }) => {
      // Leaving the notes saves straight away; the menu closes after a click on it has landed.
      window.setTimeout(() => updateSlash(null), 150);
      void flush(current);
    },
  });

  useEffect(() => { editorRef.current = editor; }, [editor]);

  // Unsaved changes are saved when the page is left.
  useEffect(() => () => {
    if (editor && timer.current) void flush(editor);
  }, [editor, flush]);

  if (!editor) return <Section title="Notes"><div className="min-h-[160px]" /></Section>;
  const list = slash ? matches(slash.query) : [];
  const inLink = editor.isActive('link');
  const href = (editor.getAttributes('link').href as string | undefined) ?? '';

  const bubble = [
    { label: 'Bold', icon: Bold, active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: Italic, active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Strikethrough', icon: Strikethrough, active: editor.isActive('strike'), run: () => editor.chain().focus().toggleStrike().run() },
    { label: 'Heading', icon: Heading2, active: editor.isActive('heading', { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Checklist', icon: ListChecks, active: editor.isActive('taskList'), run: () => editor.chain().focus().toggleTaskList().run() },
    { label: 'Link', icon: Link2, active: inLink, run: () => setLinking(href || 'https://') },
  ];

  const saved = (
    <span className="text-[11px] text-[var(--ref-on-surface-variant)]" aria-live="polite">
      {status === 'saving' ? 'Saving…' : status === 'saved' ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" aria-hidden />Saved</span> : status === 'error' ? <span className="text-[var(--color-danger)]">Not saved; keep typing to retry</span> : null}
    </span>
  );

  return (
    <Section title="Notes" aside={saved}>
    <div ref={frame} className="goal-notes relative px-4 py-4 sm:px-5">

      <BubbleMenu editor={editor} tippyOptions={{ duration: 120, placement: 'top' }} shouldShow={({ editor: current, from, to }) => from !== to && !current.isActive('codeBlock')}>
        <div className="flex items-center gap-0.5 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-1 shadow-lg">
          {linking !== null ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                const url = linking.trim();
                const chain = editor.chain().focus().extendMarkRange('link');
                (url && /^https?:\/\//i.test(url) ? chain.setLink({ href: url }) : chain.unsetLink()).run();
                setLinking(null);
              }}
            >
              <input autoFocus aria-label="Link address" value={linking} onChange={(event) => setLinking(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setLinking(null); }} className="brutalist-input h-[30px] w-56 text-xs" />
              <button type="submit" className="h-[30px] rounded-lg px-2 text-xs font-semibold text-[var(--ref-primary)] hover:bg-[var(--ref-surface-container-low)]">Save</button>
            </form>
          ) : (
            <>
              {bubble.map(({ label, icon: Icon, active, run }) => (
                <button key={label} type="button" title={label} aria-label={label} aria-pressed={active} onClick={run} className={cn('grid h-[30px] w-[30px] place-items-center rounded-lg hover:bg-[var(--ref-surface-container-low)]', active ? 'bg-[var(--ref-primary)]/10 text-[var(--ref-primary)]' : 'text-[var(--ref-on-surface-variant)]')}>
                  <Icon className="h-4 w-4" />
                </button>
              ))}
              {inLink && href && <a href={href} target="_blank" rel="noreferrer noopener" title="Open link" aria-label="Open link" className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]"><ExternalLink className="h-4 w-4" /></a>}
            </>
          )}
        </div>
      </BubbleMenu>

      <EditorContent editor={editor} />

      {empty && !editor.isFocused && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => editor.chain().focus().setContent(OUTLINE).run()} className="h-[30px] rounded-lg border border-[var(--color-border)] px-2.5 text-xs font-semibold text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]">Start from an outline</button>
          <button type="button" onClick={() => editor.chain().focus().toggleTaskList().run()} className="h-[30px] rounded-lg border border-[var(--color-border)] px-2.5 text-xs font-semibold text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)]">Add a checklist</button>
        </div>
      )}

      {slash && list.length > 0 && (
        <ul role="listbox" aria-label="Turn this line into" className="absolute z-30 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] py-1 shadow-lg" style={{ left: slash.left, top: slash.top, width: MENU_WIDTH }}>
          {list.map((item, index) => {
            const Icon = item.icon;
            return (
              <li key={item.key} role="option" aria-selected={index === slash.index}>
                <button
                  type="button"
                  onMouseDown={(event) => { event.preventDefault(); choose(editor, item); }}
                  onMouseEnter={() => updateSlash({ ...slash, index })}
                  className={cn('flex w-full items-center gap-3 px-3 py-1.5 text-left', index === slash.index && 'bg-[var(--ref-surface-container-low)]')}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] text-[var(--ref-on-surface-variant)]"><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm text-[var(--ref-on-surface)]">{item.label}</span>
                    <span className="block truncate text-[11px] text-[var(--ref-on-surface-variant)]">{item.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
    </Section>
  );
}
