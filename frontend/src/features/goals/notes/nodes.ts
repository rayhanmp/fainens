import { Extension, Node } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { DateChipView, GoalRefView, LinkCardView, SizedImageView } from './NodeViews';
import { fromIsoDate } from './notes-utils';

/**
 * The notes' own pieces. Markdown runs in HTML mode, so each is kept in the markdown as a small
 * HTML tag (a `[[` link as `<span data-goal-ref="part:12">Flights</span>`, a date as
 * `<span data-date="2027-03-14">14 Mar 2027</span>`) and read back the same way.
 */

const dateLabel = (value: string) => fromIsoDate(value)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) ?? value;
const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A `[[` link to a part, booking or file of the goal. */
export const GoalRef = Node.create({
  name: 'goalRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: 'part' }, id: { default: 0 }, label: { default: '' } };
  },
  parseHTML() {
    return [{
      tag: 'span[data-goal-ref]',
      getAttrs: (element) => {
        const [kind, id] = String((element as HTMLElement).getAttribute('data-goal-ref') ?? '').split(':');
        return kind && id ? { kind, id: Number(id), label: (element as HTMLElement).textContent ?? '' } : false;
      },
    }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-goal-ref': `${node.attrs.kind}:${node.attrs.id}` }, String(node.attrs.label)];
  },
  renderText({ node }) {
    return String(node.attrs.label);
  },
  addNodeView() {
    return ReactNodeViewRenderer(GoalRefView);
  },
});

/** An `@` date; on a checklist item, the day it's due. */
export const DateChip = Node.create({
  name: 'dateChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { date: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-date]', getAttrs: (element) => ({ date: (element as HTMLElement).getAttribute('data-date') ?? '' }) }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-date': String(node.attrs.date) }, dateLabel(String(node.attrs.date))];
  },
  renderText({ node }) {
    return dateLabel(String(node.attrs.date));
  },
  addNodeView() {
    return ReactNodeViewRenderer(DateChipView);
  },
});

/** A link shown as a card with its picture and title. */
export const LinkCard = Node.create({
  name: 'linkCard',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { href: { default: '' }, title: { default: '' }, image: { default: null } };
  },
  parseHTML() {
    return [{
      tag: 'div[data-link-card]',
      getAttrs: (element) => {
        const el = element as HTMLElement;
        const href = el.getAttribute('data-href') ?? '';
        return /^https?:\/\//i.test(href) ? { href, title: el.getAttribute('data-title') ?? '', image: el.getAttribute('data-image') || null } : false;
      },
    }];
  },
  renderHTML({ node }) {
    const attrs: Record<string, string> = { 'data-link-card': '', 'data-href': String(node.attrs.href), 'data-title': String(node.attrs.title ?? '') };
    if (node.attrs.image) attrs['data-image'] = String(node.attrs.image);
    return ['div', attrs, ['a', { href: String(node.attrs.href) }, String(node.attrs.title || node.attrs.href)]];
  },
  addNodeView() {
    return ReactNodeViewRenderer(LinkCardView);
  },
});

/** A picture, small, medium or full width; plain markdown when full, a tag when sized. */
export const SizedImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      size: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-size'),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.size ? { 'data-size': attributes.size } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(SizedImageView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: PMNode) => void; esc: (text: string) => string }, node: PMNode) {
          const src = String(node.attrs.src ?? '');
          const alt = String(node.attrs.alt ?? '');
          if (node.attrs.size && node.attrs.size !== 'full') state.write(`<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" data-size="${escapeAttr(String(node.attrs.size))}">`);
          else state.write(`![${state.esc(alt)}](${src.replace(/[()]/g, '\\$&')})`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
}).configure({ inline: false, allowBase64: false });

const foldKey = new PluginKey<Set<string>>('goal-notes-fold');

/** The top-level blocks that sit under each folded heading, until the next heading at its level or above. */
function foldDecorations(state: EditorState, folded: Set<string>): DecorationSet {
  const decorations: Decoration[] = [];
  let hiddenUnder: number | null = null;
  state.doc.forEach((node, offset) => {
    if (node.type.name === 'heading') {
      const level = Number(node.attrs.level);
      if (hiddenUnder !== null && level <= hiddenUnder) hiddenUnder = null;
      if (hiddenUnder !== null) {
        decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: 'is-folded' }));
        return;
      }
      const key = `${level}:${node.textContent}`;
      const isFolded = folded.has(key);
      decorations.push(Decoration.widget(offset + 1, () => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `goal-notes-fold${isFolded ? ' is-closed' : ''}`;
        button.setAttribute('aria-label', isFolded ? 'Show this section' : 'Fold this section');
        button.setAttribute('aria-expanded', String(!isFolded));
        button.contentEditable = 'false';
        button.dataset.foldKey = key;
        return button;
      }, { side: -1, key: `fold-${key}-${isFolded}`, ignoreSelection: true }));
      if (isFolded) {
        hiddenUnder = level;
        decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: 'is-folded-heading' }));
      }
      return;
    }
    if (hiddenUnder !== null) decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: 'is-folded' }));
  });
  return DecorationSet.create(state.doc, decorations);
}

/**
 * Sections can be folded under their heading: a small toggle sits before each heading, and a
 * folded one hides what's under it until the next heading at its level or above. Which are folded
 * is remembered per page (by heading text) in this browser.
 */
export const Folding = Extension.create<{ storageKey: string | null }>({
  name: 'goalNotesFolding',
  addOptions() {
    return { storageKey: null };
  },
  addProseMirrorPlugins() {
    const storageKey = this.options.storageKey;
    const load = (): Set<string> => {
      try {
        return new Set<string>(storageKey ? JSON.parse(localStorage.getItem(storageKey) ?? '[]') : []);
      } catch {
        return new Set();
      }
    };
    const save = (folded: Set<string>) => {
      try {
        if (storageKey) localStorage.setItem(storageKey, JSON.stringify([...folded]));
      } catch { /* storage unavailable: folds last this visit only */ }
    };
    return [new Plugin<Set<string>>({
      key: foldKey,
      state: {
        init: load,
        apply: (tr, value) => {
          const toggle = tr.getMeta(foldKey) as string | undefined;
          if (!toggle) return value;
          const next = new Set(value);
          if (next.has(toggle)) next.delete(toggle);
          else next.add(toggle);
          save(next);
          return next;
        },
      },
      props: {
        decorations: (state) => foldDecorations(state, foldKey.getState(state) ?? new Set()),
        handleDOMEvents: {
          mousedown: (view, event) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>('.goal-notes-fold');
            if (!target?.dataset.foldKey) return false;
            event.preventDefault();
            view.dispatch(view.state.tr.setMeta(foldKey, target.dataset.foldKey));
            return true;
          },
        },
      },
    })];
  },
});

export const searchKey = new PluginKey<string>('goal-notes-search');

/** Marks every match of the search words in the page. */
export const SearchHighlight = Extension.create({
  name: 'goalNotesSearch',
  addProseMirrorPlugins() {
    return [new Plugin<string>({
      key: searchKey,
      state: {
        init: () => '',
        apply: (tr, value) => {
          const next = tr.getMeta(searchKey) as string | undefined;
          return next === undefined ? value : next;
        },
      },
      props: {
        decorations: (state) => {
          const query = (searchKey.getState(state) ?? '').trim().toLowerCase();
          if (query.length < 2) return DecorationSet.empty;
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return;
            const text = node.text.toLowerCase();
            for (let at = text.indexOf(query); at >= 0; at = text.indexOf(query, at + query.length)) {
              decorations.push(Decoration.inline(pos + at, pos + at + query.length, { class: 'goal-notes-match' }));
            }
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
    })];
  },
});
