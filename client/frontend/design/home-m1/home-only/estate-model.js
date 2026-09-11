  // ---- estate model: one number drives the board, the header and the ladder ----
  var L = 100000, HOUSE = 5 * L, HOUSES = 9, INCOME = 1500;
  var ORDER = [[1,1],[2,2],[1,2],[2,1],[0,2],[2,0],[0,1],[1,0],[0,0]];
  var ESTATE_WORTH = (function () { var q = new URLSearchParams(location.search).get('worth'); var n = q ? Number(q) : NaN; return isFinite(n) && n >= 0 ? Math.min(HOUSES * HOUSE, n) : 2675000; })();
  function lakhShort(n) { return n >= 1e7 ? '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + 'Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + 'L' : inr(n); }
  function applyEstate(worth) {
    ESTATE_WORTH = worth;
    var villas = Math.min(HOUSES, Math.floor(worth / HOUSE)), rem = worth - villas * HOUSE, stage = villas >= HOUSES ? 0 : Math.floor(rem / L), building = villas < HOUSES && rem > 0;
    var cells = ORDER.map(function (o, i) {
      var col = o[0], row = o[1], n = ('0' + (i + 1)).slice(-2), st, href, name, note, paid;
      if (i < villas) { st = 'villa'; href = '#tVilla'; name = 'Villa ' + n; note = 'Complete · ₹5,00,000 · pays ₹1,500 a month'; paid = 20; }
      else if (i === villas && building) { st = 'build'; href = stage === 0 ? '#tGround' : FALLBACK_TILE[stage]; name = 'Plot ' + n; note = (stage === 0 ? 'Breaking ground' : STAGE_NAME[stage]) + ' · ' + inr(rem) + ' of ₹5,00,000'; paid = Math.round(rem / 25000); }
      else { st = 'locked'; href = '#tLocked'; name = 'Tile ' + n; note = 'open'; paid = null; }
      return { col: col, row: row, d: col + row, st: st, href: href, name: name, note: note, paid: paid };
    });
    cells.sort(function (a, b) { return (a.d - b.d) || (a.col - b.col); });
    document.getElementById('cells').innerHTML = cells.map(function (c) {
      return '<g class="cell' + (c.st === 'build' ? ' building' : '') + '" data-name="' + c.name + '" data-note="' + c.note + '" data-state="' + c.st + '" data-col="' + c.col + '" data-row="' + c.row + '"' + (c.paid !== null ? ' data-paid="' + c.paid + '"' : '') + '><use href="' + c.href + '" x="' + ((c.col - c.row) * 93.6).toFixed(1) + '" y="' + ((c.col + c.row) * 54).toFixed(1) + '"></use></g>';
    }).join('');
    // header + portfolio
    var swp = INCOME * villas;
    document.getElementById('hudSwp').textContent = inr(swp);
    document.getElementById('hudSwpSub').textContent = villas ? villas + (villas === 1 ? ' villa' : ' villas') + ' · SWP on the 1st' : 'Starts with your first villa';
    document.getElementById('hudInv').textContent = inr(worth);
    document.getElementById('hudSipSub').textContent = building ? '1 building · SIP on the 5th' : villas >= HOUSES ? 'Estate complete' : 'Next plot · SIP on the 5th';
    var months = Math.max(1, Math.round(worth / 25000)), value = worth * (1 + 0.0055 * months), ret = worth ? (value / worth - 1) * 100 : 0;
    document.getElementById('portV').textContent = inr(value);
    document.getElementById('portInv').textContent = 'Invested ' + inr(worth);
    document.getElementById('portRet').textContent = (ret >= 0 ? '+' : '') + ret.toFixed(1) + '% returns';
    var coin = document.getElementById('rentCoin'); if (coin) coin.style.display = villas ? '' : 'none';
  }
  applyEstate(ESTATE_WORTH);
  window.setEstateWorth = function (n) { applyEstate(Math.max(0, Math.min(HOUSES * HOUSE, Number(n) || 0))); ladderInit(); };
