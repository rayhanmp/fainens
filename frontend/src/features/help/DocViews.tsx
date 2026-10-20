import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Info, Layers, Lightbulb, Minus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CAN_I, CHANGELOG, GLOSSARY, LIMITS, SHORTCUTS, type CanIAnswer } from './content';
import { DOC_GROUPS, DOCS, type DocBlock, type DocPage, type LedgerEntry } from './docs';
import { exampleAccounts, useHelpPersonal } from './personal';

/** The docs' left rail: every page, grouped, with the open one highlighted like the app sidebar. */
export function DocsSidebar({ activeSlug }: { activeSlug?: string }) {
  return (
    <nav aria-label="Help topics" className="space-y-5">
      <Link to="/help" className={cn('block rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors', !activeSlug ? 'bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-accent)]' : 'text-[var(--ref-on-surface)] hover:bg-[var(--ref-surface-container-low)]')}>Help home</Link>
      {DOC_GROUPS.map((group) => (
        <div key={group}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">{group}</p>
          <ul className="space-y-0.5">
            {DOCS.filter((doc) => doc.group === group).map((doc) => (
              <li key={doc.slug}>
                <Link
                  to="/help/$slug"
                  params={{ slug: doc.slug }}
                  aria-current={activeSlug === doc.slug ? 'page' : undefined}
                  className={cn('block rounded-lg px-3 py-1.5 text-sm transition-colors', activeSlug === doc.slug ? 'bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] font-semibold text-[var(--color-accent)]' : 'text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-low)] hover:text-[var(--ref-on-surface)]')}
                >
                  {doc.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Words that link to their glossary meaning, with the forms they appear in. Longer phrases first. */
const GLOSSARY_FORMS: Array<[RegExp, string]> = [
  [/^closed periods?$/i, 'Closed period'],
  [/^balance adjustments?$/i, 'Balance adjustment'],
  [/^pending items?$/i, 'Pending item'],
  [/^net worth$/i, 'Net worth'],
  [/^cash runway$/i, 'Cash runway'],
  [/^opportunity cost$/i, 'Opportunity cost'],
  [/^budget variance$/i, 'Budget variance'],
  [/^audit log$/i, 'Audit log'],
  [/^ledger$/i, 'Ledger'],
  [/^reconcil(e|es|ed|ing|iation)$/i, 'Reconcile'],
  [/^drafts?$/i, 'Draft'],
  [/^corrections?$/i, 'Correction'],
];
const GLOSSARY_PATTERN = /\b(closed periods?|balance adjustments?|pending items?|net worth|cash runway|opportunity cost|budget variance|audit log|ledger|reconcil(?:e|es|ed|ing|iation)|drafts?|corrections?)\b/gi;
const GLOSSARY_MEANING = new Map(GLOSSARY.map(([term, meaning]) => [term, meaning]));

/** A glossary word in running text: dotted underline, meaning on hover, focus or tap. */
function Term({ text, meaning }: { text: string; meaning: string }) {
  return (
    <span tabIndex={0} className="group/term relative cursor-help rounded-sm underline decoration-[var(--color-muted)] decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40">
      {text}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 w-max max-w-[min(16rem,75vw)] rounded-lg bg-[var(--ref-on-surface)] px-3 py-2 text-xs font-normal leading-relaxed text-[var(--color-surface)] no-underline opacity-0 shadow-lg transition-opacity duration-150 group-hover/term:opacity-100 group-focus/term:opacity-100">
        {meaning}
      </span>
    </span>
  );
}

/** Underlines the first appearance of each glossary word on the page; `used` is shared across the page's blocks. */
function withGlossary(text: string, used: Set<string>): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(GLOSSARY_PATTERN)) {
    const word = match[0];
    const term = GLOSSARY_FORMS.find(([pattern]) => pattern.test(word))?.[1];
    const meaning = term ? GLOSSARY_MEANING.get(term) : undefined;
    if (!term || !meaning || used.has(term)) continue;
    used.add(term);
    parts.push(text.slice(last, match.index), <Term key={match.index} text={word} meaning={meaning} />);
    last = (match.index ?? 0) + word.length;
  }
  if (parts.length === 0) return text;
  parts.push(text.slice(last));
  return parts;
}

const CALLOUT = {
  tip: { icon: Lightbulb, className: 'border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8', iconClass: 'text-[var(--color-warning)]' },
  note: { icon: Info, className: 'border-[var(--color-accent)]/25 bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)]', iconClass: 'text-[var(--color-accent)]' },
  warning: { icon: AlertTriangle, className: 'border-[var(--color-danger)]/25 bg-[var(--color-danger)]/6', iconClass: 'text-[var(--color-danger)]' },
} as const;

const CAN_I_STYLE: Record<CanIAnswer['answer'], { label: string; icon: React.ElementType; className: string }> = {
  yes: { label: 'Yes', icon: Check, className: 'bg-[var(--color-success)]/12 text-[var(--color-success)]' },
  partly: { label: 'Partly', icon: Minus, className: 'bg-[var(--color-warning)]/14 text-[var(--color-warning)]' },
  no: { label: 'No', icon: X, className: 'bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]' },
};

function Keycap({ children }: { children: string }) {
  return <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 border-[var(--color-border-strong)] bg-[var(--color-surface)] px-1.5 font-sans text-xs font-semibold text-[var(--ref-on-surface)]">{children}</kbd>;
}

function ChangelogTimeline() {
  const [showAll, setShowAll] = useState(false);
  const months = showAll ? CHANGELOG : CHANGELOG.slice(0, 2);
  return (
    <div>
      <ol className="relative ml-2 border-l border-[var(--color-border)] pl-6">
        {months.map((month) => (
          <li key={month.month} className="relative pb-8 last:pb-0">
            <span className="absolute -left-[33px] top-0.5 grid h-4 w-4 place-items-center rounded-full bg-[var(--color-background)] ring-2 ring-[var(--color-accent)]" aria-hidden><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" /></span>
            <h2 className="font-headline text-base font-bold text-[var(--ref-on-surface)]">{month.month}</h2>
            <ul className="mt-3 grid gap-x-10 gap-y-3.5 md:grid-cols-2">
              {month.highlights.map((item) => (
                <li key={item.title}>
                  <p className="text-sm font-semibold text-[var(--ref-on-surface)]">{item.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{item.body}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {CHANGELOG.length > 2 && (
        <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-accent)] hover:underline">
          {showAll ? 'Show less' : 'Show earlier months'}<ChevronDown className={cn('h-4 w-4 transition-transform', showAll && 'rotate-180')} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** "What Fainens records": the real ledger lines behind an action, for readers who want the detail. */
function UnderTheHood({ entries }: { entries: LedgerEntry[] }) {
  const { first, second, payLater } = exampleAccounts(useHelpPersonal());
  const named = (text: string) => text.replaceAll('{cash}', first).replaceAll('{cash2}', second).replaceAll('{paylater}', payLater);
  return (
    <details className="group/hood mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-[var(--ref-surface-container-low)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ref-primary)]/40 [&::-webkit-details-marker]:hidden">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--ref-surface-container)] text-[var(--ref-on-surface-variant)]"><Layers className="h-4 w-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--ref-on-surface)]">Under the hood: what Fainens records</span>
          <span className="block text-xs text-[var(--ref-on-surface-variant)]">The exact ledger lines, for when you want to know why a number is what it is</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform group-open/hood:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-6 border-t border-[var(--color-border)] px-4 py-4">
        <p className="text-xs leading-relaxed text-[var(--ref-on-surface-variant)]">Every entry has two sides that add up. <strong className="text-[var(--ref-on-surface)]">Debit</strong> is money arriving in an account, or a cost being counted. <strong className="text-[var(--ref-on-surface)]">Credit</strong> is money leaving an account, or income or debt being counted. Categories label spending; they aren’t accounts, so spending is recorded in one built-in account, <em>Expense (Auto)</em>, with the category attached.</p>
        {entries.map((entry) => (
          <div key={entry.title}>
            <p className="text-sm font-semibold text-[var(--ref-on-surface)]">{named(entry.title)}</p>
            {entry.lines.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--ref-on-surface-variant)]">No ledger lines</p>
            ) : (
            <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--color-border)]">
              <table className="w-full min-w-[22rem] text-left text-sm">
                <thead className="bg-[var(--ref-surface-container-low)] text-[11px] uppercase tracking-wider text-[var(--ref-on-surface-variant)]">
                  <tr><th className="px-3 py-2 font-semibold">Account</th><th className="w-28 px-3 py-2 text-right font-semibold">Debit</th><th className="w-28 px-3 py-2 text-right font-semibold">Credit</th></tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {entry.lines.map((line, index) => (
                    <tr key={index}>
                      <td className="px-3 py-2 text-[var(--ref-on-surface)]">{named(line.account)}{line.note && <span className="block text-xs text-[var(--ref-on-surface-variant)]">{named(line.note)}</span>}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--ref-on-surface)]">{line.debit ?? ''}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--ref-on-surface)]">{line.credit ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            <p className="mt-2 text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{named(entry.explain)}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Limits, with where the reader stands next to the ones Fainens can count for them. */
function LimitsTable() {
  const personal = useHelpPersonal();
  const yours: Record<string, string> = personal.ready ? { 'Agent memories': `You have ${personal.memoryCount}` } : {};
  return (
    <dl className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
      {LIMITS.map(([limit, value]) => (
        <div key={limit} className="flex items-baseline justify-between gap-4 py-3">
          <dt className="text-sm font-medium text-[var(--ref-on-surface)]">{limit}</dt>
          <dd className="text-right text-sm text-[var(--ref-on-surface-variant)]">{value}{yours[limit] && <span className="mt-0.5 block text-xs font-semibold text-[var(--color-accent)]">{yours[limit]}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function SpecialBlock({ name }: { name: Extract<DocBlock, { type: 'special' }>['name'] }) {
  if (name === 'can-i') {
    return (
      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {CAN_I.map((item) => {
          const { label, icon: Icon, className } = CAN_I_STYLE[item.answer];
          return (
            <div key={item.question} className="flex items-start gap-3 py-3.5">
              <span className={cn('mt-0.5 inline-flex w-[4.75rem] shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', className)}><Icon className="h-3 w-3" strokeWidth={3} aria-hidden />{label}</span>
              <div className="min-w-0"><p className="text-sm font-semibold text-[var(--ref-on-surface)]">{item.question}</p><p className="mt-0.5 text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{item.detail}</p></div>
            </div>
          );
        })}
      </div>
    );
  }
  if (name === 'limits') return <LimitsTable />;
  if (name === 'shortcuts') {
    return (
      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {SHORTCUTS.map((shortcut) => (
          <div key={`${shortcut.where}-${shortcut.action}`} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0"><p className="text-sm text-[var(--ref-on-surface)]">{shortcut.action}</p><p className="text-xs text-[var(--ref-on-surface-variant)]">{shortcut.where}</p></div>
            <span className="flex shrink-0 items-center gap-1">{shortcut.keys.map((key, index) => <span key={key} className="flex items-center gap-1">{index > 0 && <span className="text-xs text-[var(--color-muted)]">{key === '→' ? '/' : '+'}</span>}<Keycap>{key}</Keycap></span>)}</span>
          </div>
        ))}
      </div>
    );
  }
  if (name === 'glossary') {
    return (
      <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
        {GLOSSARY.map(([term, meaning]) => <div key={term}><dt className="text-sm font-semibold text-[var(--ref-on-surface)]">{term}</dt><dd className="mt-0.5 text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{meaning}</dd></div>)}
      </dl>
    );
  }
  return <ChangelogTimeline />;
}

function BlockView({ block, used }: { block: DocBlock; used: Set<string> }) {
  switch (block.type) {
    case 'p':
      return <p className="mt-3 text-[15px] leading-7 text-[var(--ref-on-surface-variant)]">{withGlossary(block.text, used)}</p>;
    case 'h2':
      return <h2 id={block.id} className="mt-10 scroll-mt-6 font-headline text-xl font-bold tracking-tight text-[var(--ref-on-surface)]">{block.text}</h2>;
    case 'steps':
      return (
        <ol className="mt-4 space-y-3">
          {block.items.map((step, index) => (
            <li key={step} className="flex gap-3 text-[15px] leading-7 text-[var(--ref-on-surface-variant)]">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-xs font-bold tabular-nums text-[var(--color-accent)]">{index + 1}</span>
              <span>{withGlossary(step, used)}</span>
            </li>
          ))}
        </ol>
      );
    case 'list':
      return (
        <ul className="mt-3 space-y-2">
          {block.items.map((item) => <li key={item} className="flex gap-3 text-[15px] leading-7 text-[var(--ref-on-surface-variant)]"><span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" aria-hidden /><span>{withGlossary(item, used)}</span></li>)}
        </ul>
      );
    case 'callout': {
      const { icon: Icon, className, iconClass } = CALLOUT[block.tone];
      return (
        <div className={cn('mt-5 flex gap-3 rounded-xl border px-4 py-3', className)}>
          <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass)} aria-hidden />
          <div className="text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{block.title && <p className="font-semibold text-[var(--ref-on-surface)]">{block.title}</p>}<p>{block.text}</p></div>
        </div>
      );
    }
    case 'visual':
      return <>{block.node}</>;
    case 'table':
      return (
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-border)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--ref-surface-container-low)] text-xs uppercase tracking-wider text-[var(--ref-on-surface-variant)]"><tr>{block.head.map((cell) => <th key={cell} className="px-4 py-2.5 font-semibold">{cell}</th>)}</tr></thead>
            <tbody className="divide-y divide-[var(--color-border)]">{block.rows.map(([a, b]) => <tr key={a}><td className="px-4 py-2.5 font-medium text-[var(--ref-on-surface)]">{a}</td><td className="px-4 py-2.5 text-[var(--ref-on-surface-variant)]">{b}</td></tr>)}</tbody>
          </table>
        </div>
      );
    case 'qa':
      return (
        <div className="mt-4 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {block.items.map((item) => <div key={item.q} className="py-4"><p className="text-[15px] font-semibold text-[var(--ref-on-surface)]">{item.q}</p><p className="mt-1 text-[15px] leading-7 text-[var(--ref-on-surface-variant)]">{item.a}</p></div>)}
        </div>
      );
    case 'open':
      return <Link to={block.link.to} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] px-3 py-1.5 text-sm font-semibold text-[var(--color-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)]">{block.link.label}<ArrowRight className="h-4 w-4" aria-hidden /></Link>;
    case 'special':
      return <div className="mt-6"><SpecialBlock name={block.name} /></div>;
    case 'under-hood':
      return <UnderTheHood entries={block.entries} />;
  }
}

/** A full doc page: heading, "on this page", content, related pages and previous/next. */
export function DocArticle({ page }: { page: DocPage }) {
  const index = DOCS.findIndex((doc) => doc.slug === page.slug);
  const previous = DOCS[index - 1];
  const next = DOCS[index + 1];
  const headings = page.blocks.filter((block): block is Extract<DocBlock, { type: 'h2' }> => block.type === 'h2');
  const related = (page.related ?? []).map((slug) => DOCS.find((doc) => doc.slug === slug)).filter((doc): doc is DocPage => Boolean(doc));

  return (
    <article className="min-w-0 max-w-3xl">
      <Link to="/help" className="mb-5 inline-flex items-center gap-1 text-sm font-medium text-[var(--ref-on-surface-variant)] hover:text-[var(--ref-on-surface)] lg:hidden"><ArrowLeft className="h-4 w-4" aria-hidden />All help topics</Link>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)]">{page.group}</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[var(--ref-on-surface)] md:text-4xl">{page.title}</h1>
      <p className="mt-3 text-lg leading-8 text-[var(--ref-on-surface-variant)]">{page.lead}</p>

      {headings.length > 2 && (
        <nav aria-label="On this page" className="mt-6 flex flex-wrap items-center gap-2 border-y border-[var(--color-border)] py-3">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">On this page</span>
          {headings.map((heading) => (
            <a key={heading.id} href={`#${heading.id}`} onClick={(event) => { event.preventDefault(); document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="rounded-full bg-[var(--ref-surface-container-low)] px-2.5 py-1 text-xs font-medium text-[var(--ref-on-surface)] hover:text-[var(--color-accent)]">{heading.text.replace(/^\d+\.\s*/, '')}</a>
          ))}
        </nav>
      )}

      {/* A fresh set each render, so every page underlines each glossary word once, in reading order. */}
      <div className="mt-2">{(() => { const used = new Set<string>(); return page.blocks.map((block, blockIndex) => <BlockView key={blockIndex} block={block} used={used} />); })()}</div>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">Related</h2>
          <ul className="mt-2 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {related.map((doc) => (
              <li key={doc.slug}>
                <Link to="/help/$slug" params={{ slug: doc.slug }} className="group flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0"><span className="block text-sm font-semibold text-[var(--ref-on-surface)] group-hover:text-[var(--color-accent)]">{doc.title}</span><span className="block text-xs text-[var(--ref-on-surface-variant)]">{doc.summary}</span></span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav aria-label="Previous and next" className="mt-10 grid grid-cols-2 gap-3">
        {previous ? (
          <Link to="/help/$slug" params={{ slug: previous.slug }} className="group rounded-xl border border-[var(--color-border)] px-4 py-3 transition-colors hover:border-[var(--color-accent)]">
            <span className="flex items-center gap-1 text-xs text-[var(--ref-on-surface-variant)]"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Previous</span>
            <span className="mt-0.5 block text-sm font-semibold text-[var(--ref-on-surface)] group-hover:text-[var(--color-accent)]">{previous.title}</span>
          </Link>
        ) : <span />}
        {next && (
          <Link to="/help/$slug" params={{ slug: next.slug }} className="group rounded-xl border border-[var(--color-border)] px-4 py-3 text-right transition-colors hover:border-[var(--color-accent)]">
            <span className="flex items-center justify-end gap-1 text-xs text-[var(--ref-on-surface-variant)]">Next<ArrowRight className="h-3.5 w-3.5" aria-hidden /></span>
            <span className="mt-0.5 block text-sm font-semibold text-[var(--ref-on-surface)] group-hover:text-[var(--color-accent)]">{next.title}</span>
          </Link>
        )}
      </nav>
    </article>
  );
}
