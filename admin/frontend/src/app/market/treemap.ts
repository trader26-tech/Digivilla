/**
 * The heat map's layout: a squarified treemap (Bruls, Huizing & van Wijk) — areas in proportion
 * to a weight, rectangles kept as close to square as the weights allow, biggest first.
 */
export interface Rect { x: number; y: number; w: number; h: number }

/** `weights` must be sorted biggest first; returns one rectangle per weight, same order. */
export function squarify(weights: number[], box: Rect): Rect[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!weights.length || total <= 0 || box.w <= 0 || box.h <= 0) return weights.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const k = (box.w * box.h) / total;
  const areas = weights.map((v) => v * k);
  const out: Rect[] = [];
  let { x, y, w, h } = box, i = 0;
  // the worst aspect ratio in a row laid along a side of length s
  const worst = (row: number[], s: number) => {
    const sum = row.reduce((a, b) => a + b, 0), mx = Math.max(...row), mn = Math.min(...row);
    return Math.max((s * s * mx) / (sum * sum), (sum * sum) / (s * s * mn));
  };
  while (i < areas.length) {
    const s = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], s) <= worst(row, s)) row.push(areas[j++]);
    const sum = row.reduce((a, b) => a + b, 0);
    if (w >= h) {            // a column on the left
      const cw = sum / h; let yy = y;
      for (const a of row) { out.push({ x, y: yy, w: cw, h: a / cw }); yy += a / cw; }
      x += cw; w -= cw;
    } else {                 // a row along the top
      const rh = sum / w; let xx = x;
      for (const a of row) { out.push({ x: xx, y, w: a / rh, h: rh }); xx += a / rh; }
      y += rh; h -= rh;
    }
    i = j;
  }
  return out;
}

/**
 * How big each market is drawn: roughly the size of the market it stands for (US$ trillions —
 * an index's market value, a commodity's or currency's footprint), so the S&P 500 outweighs the
 * Russell 2000 and the Nikkei outweighs the Straits Times. Squashed (^0.45) when drawn, so the
 * smallest tile can still be read. Funds share their block equally.
 */
export const MARKET_SIZE: Record<string, number> = {
  nifty50: 3, nifty500: 2.4, sensex: 1.8, nifty100: 1.5, banknifty: 1.1, midcap150: 1.1, next50: 0.9, smallcap250: 0.8, midcap50: 0.6, goldbees: 0.35,
  sp500: 50, nasdaq: 30, nasdaq100: 26, dow: 15, russell: 3.2, vix: 1.2,
  tsx: 3.4, bovespa: 0.9, ipc: 0.5,
  shanghai: 9, nikkei: 6.5, hangseng: 4.5, taiwan: 2.6, kospi: 2.1, asx: 2, jakarta: 0.8, sti: 0.6,
  stoxx50: 5, ftse: 3.5, cac: 3, dax: 2.6, smi: 2, aex: 1.2, ibex: 0.9, ftsemib: 0.9,
  gold: 20, msciworld: 12, bitcoin: 2.2,
  wti: 2, brent: 2, silver: 1.6, copper: 1.2, natgas: 0.9,
  dxy: 1.6, eurusd: 1.5, usdjpy: 1.3, gbpusd: 1.1, usdinr: 1.1,
  us10y: 2, us30y: 1.3, us5y: 1.3, us3m: 1,
};

/** each region's share of the map — the regions' reading order and how much room each gets */
export const REGION_SIZE: Record<string, number> = {
  India: 1.7, Funds: 0.95, US: 1.45, Europe: 1.2, Asia: 1.3, Americas: 0.55, Global: 0.55, Commodities: 0.62, Currencies: 0.78, Bonds: 0.5,
};
