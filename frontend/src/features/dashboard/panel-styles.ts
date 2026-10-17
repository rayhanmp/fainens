/** The one card every dashboard panel sits on. */
export const panelCard = 'rounded-3xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-sm sm:p-6';

/** Panel titles, matching the panel names in the View menu. */
export const panelTitle = 'font-headline text-xl font-extrabold text-[var(--ref-on-surface)]';

/** Muted line under a panel title. */
export const panelSubtitle = 'mt-1 text-xs text-[var(--ref-on-surface-variant)]';

/** Small uppercase labels ("AT A GLANCE", metric names). Colour is set by the context. */
export const microLabel = 'text-[11px] font-bold uppercase tracking-widest';

/** Text links inside panels, always followed by an arrow icon. */
export const panelLink = 'inline-flex items-center gap-1 text-sm font-bold text-[var(--ref-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ref-primary)]';

/** Hover and focus tooltips. */
export const tooltipSurface = 'pointer-events-none absolute z-30 hidden w-64 rounded-xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-3 text-left text-xs leading-relaxed text-[var(--ref-on-surface)] shadow-xl group-hover:block group-focus-within:block';

/** Dropdown popovers (notifications, chart options). */
export const popoverSurface = 'rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] shadow-2xl';
