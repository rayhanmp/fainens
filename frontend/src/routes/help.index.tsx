import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Search, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { DOC_GROUPS, DOCS, docText, type DocPage } from '../features/help/docs';
import { useHelpPersonal } from '../features/help/personal';

export const Route = createFileRoute('/help/')({
  component: HelpHome,
});

const POPULAR = ['fixing-mistakes', 'accounts', 'transfers', 'split-bills', 'pay-later', 'agent'];
const START_HERE = ['welcome', 'quick-start', 'key-ideas'];

/** The sentence of a page that best matches the search, shown under the result. */
function snippet(page: DocPage, terms: string[]): string {
  const sentences = docText(page).split(/(?<=[.!?])\s+/);
  return sentences.find((sentence) => terms.some((term) => sentence.toLowerCase().includes(term))) ?? page.summary;
}

function HelpHome() {
  const [query, setQuery] = useState('');
  const personal = useHelpPersonal();
  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => {
    if (terms.length === 0) return [];
    return DOCS
      .map((page) => {
        const title = page.title.toLowerCase();
        const text = docText(page).toLowerCase();
        if (!terms.every((term) => text.includes(term))) return null;
        // Title matches first, then pages that mention the words most.
        const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 10 : 0) + text.split(term).length - 1, 0);
        return { page, score };
      })
      .filter((result): result is { page: DocPage; score: number } => Boolean(result))
      .sort((a, b) => b.score - a.score);
  }, [terms]);

  const bySlug = (slug: string) => DOCS.find((doc) => doc.slug === slug)!;

  return (
    <div className="space-y-12">
      <section className="rounded-3xl bg-[color-mix(in_srgb,var(--color-accent)_7%,var(--color-surface))] px-5 py-8 sm:px-8 sm:py-10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)]">Help centre</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[var(--ref-on-surface)] md:text-4xl">{personal.name ? `Hi ${personal.name}, how can we help?` : 'How can we help?'}</h1>
        <p className="mt-2 max-w-xl text-[15px] text-[var(--ref-on-surface-variant)]">Guides for every part of Fainens, with worked examples, the rules behind your numbers, and what’s new.</p>
        <div className="relative mt-6 max-w-2xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--color-muted)]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }}
            placeholder="Search the docs, e.g. “split a bill”"
            aria-label="Search the docs"
            className={cn('h-12 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] pl-12 text-[15px] shadow-sm outline-none transition placeholder:text-[var(--color-muted)] focus:border-[var(--ref-primary-container)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ref-primary-container)_18%,transparent)] [&::-webkit-search-cancel-button]:hidden', query ? 'pr-12' : 'pr-4')}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--ref-surface-container)] hover:text-[var(--ref-on-surface)]" aria-label="Clear search">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        {!query && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[var(--ref-on-surface-variant)]">Popular:</span>
            {POPULAR.map((slug) => (
              <Link key={slug} to="/help/$slug" params={{ slug }} className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--ref-on-surface)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
                {bySlug(slug).title}
              </Link>
            ))}
          </div>
        )}
      </section>

      {query ? (
        <section aria-live="polite" className="max-w-3xl">
          <p className="text-sm text-[var(--ref-on-surface-variant)]">{results.length === 0 ? <>Nothing found for “{query.trim()}”. Try a simpler word, or <Link to="/agent" className="font-semibold text-[var(--color-accent)] hover:underline">ask Agent</Link>.</> : `${results.length} ${results.length === 1 ? 'page' : 'pages'}`}</p>
          <ul className="mt-3 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {results.map(({ page }) => (
              <li key={page.slug}>
                <Link to="/help/$slug" params={{ slug: page.slug }} className="group block py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]">{page.group}</p>
                  <p className="mt-0.5 text-[15px] font-semibold text-[var(--ref-on-surface)] group-hover:text-[var(--color-accent)]">{page.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{snippet(page, terms)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <section aria-labelledby="start-here">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)]">New here?</p>
            <h2 id="start-here" className="mt-1 font-headline text-2xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">Start here</h2>
            <ol className="mt-5 grid gap-4 md:grid-cols-3">
              {START_HERE.map((slug, index) => {
                const page = bySlug(slug);
                return (
                  <li key={slug}>
                    <Link to="/help/$slug" params={{ slug }} className="group flex h-full gap-3.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-accent)]">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] font-headline text-sm font-bold text-white">{index + 1}</span>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold text-[var(--ref-on-surface)] group-hover:text-[var(--color-accent)]">{page.title}</span>
                        <span className="mt-0.5 block text-sm leading-relaxed text-[var(--ref-on-surface-variant)]">{page.summary}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-labelledby="all-topics">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ref-secondary)]">Browse</p>
            <h2 id="all-topics" className="mt-1 font-headline text-2xl font-extrabold tracking-tight text-[var(--ref-on-surface)]">All topics</h2>
            <div className="mt-5 grid gap-x-12 gap-y-8 sm:grid-cols-2">
              {DOC_GROUPS.filter((group) => group !== 'Getting started').map((group) => (
                <div key={group}>
                  <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ref-on-surface-variant)]"><BookOpen className="h-3.5 w-3.5" aria-hidden />{group}</h3>
                  <ul className="mt-2 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                    {DOCS.filter((doc) => doc.group === group).map((doc) => (
                      <li key={doc.slug}>
                        <Link to="/help/$slug" params={{ slug: doc.slug }} className="group flex items-center justify-between gap-3 py-2.5">
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-[var(--ref-on-surface)] group-hover:text-[var(--color-accent)]">{doc.title}</span>
                            <span className="block truncate text-xs text-[var(--ref-on-surface-variant)]">{doc.summary}</span>
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform group-hover:translate-x-0.5" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col items-start gap-4 rounded-3xl bg-[var(--ref-surface-container-low)] px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]"><Sparkles className="h-5 w-5" aria-hidden /></span>
              <div>
                <p className="text-[15px] font-semibold text-[var(--ref-on-surface)]">Can’t find it?</p>
                <p className="mt-0.5 text-sm text-[var(--ref-on-surface-variant)]">Ask Agent. It can look at your own transactions, budget and accounts to answer.</p>
              </div>
            </div>
            <Link to="/agent" className="brutalist-button inline-flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm text-white">Ask Agent<ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </section>
        </>
      )}
    </div>
  );
}
