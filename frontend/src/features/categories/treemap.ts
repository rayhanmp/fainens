export type TreemapRect = { x: number; y: number; w: number; h: number };

/** The worst (largest) aspect ratio a row of areas gets when laid along a side of this length. */
function worst(row: number[], side: number): number {
  const sum = row.reduce((total, area) => total + area, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): lays values, largest first, into a w×h box so
 * each tile's area is proportional to its value and tiles stay as square as possible. Returns one
 * rectangle per value, in the order given (sort descending first for the best result).
 */
export function squarify(values: number[], width: number, height: number): TreemapRect[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || values.length === 0) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const areas = values.map((value) => (value / total) * width * height);
  const rects: TreemapRect[] = [];
  let free = { x: 0, y: 0, w: width, h: height };
  let row: number[] = [];

  const placeRow = () => {
    const sum = row.reduce((total, area) => total + area, 0);
    if (free.w >= free.h) {
      // A column on the left of the free space.
      const columnWidth = sum / free.h;
      let y = free.y;
      for (const area of row) {
        const h = area / columnWidth;
        rects.push({ x: free.x, y, w: columnWidth, h });
        y += h;
      }
      free = { x: free.x + columnWidth, y: free.y, w: free.w - columnWidth, h: free.h };
    } else {
      // A row along the top of the free space.
      const rowHeight = sum / free.w;
      let x = free.x;
      for (const area of row) {
        const w = area / rowHeight;
        rects.push({ x, y: free.y, w, h: rowHeight });
        x += w;
      }
      free = { x: free.x, y: free.y + rowHeight, w: free.w, h: free.h - rowHeight };
    }
    row = [];
  };

  for (const area of areas) {
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, area], side) <= worst(row, side)) row.push(area);
    else {
      placeRow();
      row.push(area);
    }
  }
  if (row.length > 0) placeRow();
  return rects;
}
