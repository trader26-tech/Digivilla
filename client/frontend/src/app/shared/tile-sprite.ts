/**
 * The board tile symbols (#lvVilla · #lvLand · #lvGrade · #lvFound · #lvSteel ·
 * #lvGround) live in a static sprite, assets/house-tiles.svg. Inject it into the
 * page once so any `<use href="#lvVilla">` resolves, on whichever screen asks.
 */
let loaded = false;
export function loadTileSprite(): void {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  fetch('assets/house-tiles.svg').then((r) => r.text()).then((svg) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = svg;
    document.body.appendChild(host);
  }).catch(() => { loaded = false; });
}
