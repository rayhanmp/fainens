/**
 * Page scroll lock for overlays (modals, sheets, dialogs).
 *
 * Hiding the page scrollbar widens the layout by the scrollbar's width, which makes
 * centred and right-aligned content jump. While locked, the body gets padding equal to
 * that width so nothing moves, and the overlay's backdrop still covers the whole screen.
 * Locks are counted, so stacked overlays unlock only when the last one closes.
 */
let lockCount = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

export function lockPageScroll(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const { body, documentElement } = document;
  if (lockCount === 0) {
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    if (scrollbarWidth > 0) {
      const currentPadding = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
    // Fixed elements pinned to the right edge can use this to stay put too.
    documentElement.style.setProperty('--scroll-lock-gap', `${Math.max(0, scrollbarWidth)}px`);
    // Lets page chrome step aside while an overlay is open (the phone dock would sit on top of a sheet).
    documentElement.dataset.overlayOpen = 'true';
    body.style.overflow = 'hidden';
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount > 0 || !saved) return;
    body.style.overflow = saved.overflow;
    body.style.paddingRight = saved.paddingRight;
    documentElement.style.removeProperty('--scroll-lock-gap');
    delete documentElement.dataset.overlayOpen;
    saved = null;
  };
}
