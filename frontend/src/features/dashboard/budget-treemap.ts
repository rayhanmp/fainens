export type TreemapInput = { key: string; value: number };
export type TreemapTile = { key: string; x: number; y: number; width: number; height: number };

type Cell = { key: string; area: number };

const sum = (cells: readonly Cell[]) => cells.reduce((total, cell) => total + cell.area, 0);

/** The worst aspect ratio in a row laid along a side of `length`; lower is squarer. */
function worstRatio(row: readonly Cell[], length: number): number {
  const total = sum(row);
  if (total <= 0 || length <= 0) return Infinity;
  const areas = row.map((cell) => cell.area);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((length * length * max) / (total * total), (total * total) / (length * length * min));
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): tiles sized by value, laid in rows along the
 * shorter side of the remaining space so they stay close to square. Zero or negative values are dropped.
 */
export function squarify(items: readonly TreemapInput[], width: number, height: number): TreemapTile[] {
  const positive = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((acc, item) => acc + item.value, 0);
  if (positive.length === 0 || width <= 0 || height <= 0 || total <= 0) return [];
  const scale = (width * height) / total;
  const out: TreemapTile[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let row: Cell[] = [];

  const layoutRow = () => {
    const rowArea = sum(row);
    if (rowArea <= 0) { row = []; return; }
    if (w >= h) {
      // A vertical strip on the left, as tall as the remaining space.
      const stripWidth = rowArea / h;
      let top = y;
      for (const cell of row) {
        const tileHeight = cell.area / stripWidth;
        out.push({ key: cell.key, x, y: top, width: stripWidth, height: tileHeight });
        top += tileHeight;
      }
      x += stripWidth;
      w -= stripWidth;
    } else {
      // A horizontal strip along the top, as wide as the remaining space.
      const stripHeight = rowArea / w;
      let left = x;
      for (const cell of row) {
        const tileWidth = cell.area / stripHeight;
        out.push({ key: cell.key, x: left, y, width: tileWidth, height: stripHeight });
        left += tileWidth;
      }
      y += stripHeight;
      h -= stripHeight;
    }
    row = [];
  };

  for (const item of positive) {
    const cell = { key: item.key, area: item.value * scale };
    const side = Math.min(w, h);
    if (row.length === 0 || worstRatio([...row, cell], side) <= worstRatio(row, side)) {
      row.push(cell);
    } else {
      layoutRow();
      row.push(cell);
    }
  }
  layoutRow();
  return out;
}
