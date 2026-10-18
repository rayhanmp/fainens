/**
 * Fit a treemap tile's label after layout: drop the amount, then the percentage, until the block fits, and colour
 * each remaining line white when its middle sits below the waterline (whole lines only, so text never splits
 * mid-letter). The frosted strip behind the label follows the label's real height.
 */
export function fitTileLabel(tile: HTMLElement, text: HTMLElement, height: number, used: number): void {
  const lines = Array.from(text.children) as HTMLElement[];
  for (const line of lines) line.hidden = false;
  // A single long word ("Entertainment") cannot wrap, so shrink the name until it fits the tile's width.
  const name = lines[0];
  if (name) {
    name.style.fontSize = '';
    let size = parseFloat(getComputedStyle(name).fontSize) || 13;
    while (name.scrollWidth > name.clientWidth + 1 && size > 10) {
      size -= 0.5;
      name.style.fontSize = `${size}px`;
    }
  }
  const limit = height - 6;
  for (let index = lines.length - 1; index > 0 && text.offsetTop + text.offsetHeight > limit; index -= 1) lines[index].hidden = true;
  const waterline = height * (1 - used);
  for (const line of lines) {
    if (line.hidden) continue;
    line.dataset.onLiquid = String(line.offsetTop + line.offsetHeight / 2 > waterline);
  }
  tile.style.setProperty('--header', `${Math.min(height, text.offsetTop + text.offsetHeight + 10)}px`);
}

/**
 * A soft floor: every tile gets the same small extra area, so tiny categories grow enough to label while order and
 * differences are kept (a hard minimum would make every small category the same size). Labels carry exact numbers.
 */
export const TILE_AREA_OFFSET_SHARE = 0.05;

export function tileValues<T extends { key: string; value: number }>(items: T[]): T[] {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const offset = total * TILE_AREA_OFFSET_SHARE;
  return items.map((item) => (item.value > 0 ? { ...item, value: item.value + offset } : item));
}
