/** The calculator's data: the SETTINGS (GET /calc/config — villas, SWP rates,
 *  tax, flat assumptions) and the benchmark HISTORY (GET /calc/villa-funds —
 *  real month-end index values since Apr 2010). Both come from the DigiVilla
 *  API, the same two calls the app makes, so the website shows the app's numbers.
 *
 *  A copy is kept on the device. A copy younger than a day answers at once and
 *  is never swapped under the user mid-view (a figure must not paint, then
 *  change); past an hour it is refreshed quietly for the next visit. With no
 *  copy, the network answers; an old copy is the fallback when offline.
 *
 *  Pages that embed the calculator start the two fetches from an inline script
 *  in <head> (window.__tdcCalc) so the data is usually in before the user
 *  scrolls down to it. */
const API = (window.__TDC_API || 'https://client-digivilla-production.up.railway.app').replace(/\/$/, '');
const KEY = 'tdc.calc.v1';
const FRESH = 60 * 60 * 1000;            // an hour: refresh in the background after this
const MAX_AGE = 24 * 60 * 60 * 1000;     // a day: older than this waits for the network

function read() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c && c.cfg && c.cfg.villas && c.vf && c.vf.funds && c.at ? c : null;
  } catch (e) { return null; }
}
function write(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* private mode */ } }

const json = (r) => { if (!r.ok) throw new Error(r.url + ' ' + r.status); return r.json(); };

function fromNet() {
  const early = window.__tdcCalc; window.__tdcCalc = null;      // use the head's fetches once
  const get = (p, e) => (e ? e : fetch(API + p, { priority: 'low' }).then(json));
  return Promise.all([get('/calc/config', early && early.cfg), get('/calc/villa-funds', early && early.vf)])
    .then(([cfg, vf]) => {
      if (!cfg || !cfg.villas || !cfg.villas.length || !vf || !vf.ok || !vf.funds || !vf.funds.length) throw new Error('calc data incomplete');
      const c = { cfg, vf, at: Date.now() };
      write(c);
      return c;
    });
}

let inflight = null;
const net = () => inflight || (inflight = fromNet().finally(() => { inflight = null; }));

/** Resolves { cfg, vf }. Rejects only when there is no copy at all and the network fails. */
export function loadCalc() {
  const c = read(), age = c ? Date.now() - c.at : Infinity;
  if (c && age < MAX_AGE) {
    if (age > FRESH) net().catch(() => {});
    return Promise.resolve(c);
  }
  return net().catch((err) => { if (c) return c; throw err; });
}

export { API };
