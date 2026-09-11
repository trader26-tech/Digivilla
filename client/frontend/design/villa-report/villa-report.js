  // ---- villa report: what one ₹5L house is made of, how it has behaved, what could go wrong ----
  // Fund figures are illustrative (public factsheet ranges as of mid-2026) — wire to live data before launch.
  var VR_FUNDS = [
    { n: 'Kotak Arbitrage Fund', tag: 'ARB', c: '#8fb7b0', w: .36, amt: 179991, cagr: [7.4, 7.0, 6.1], beta: 0.02, sd: 0.7, mdd: -0.4, ter: 0.43, aum: '₹68,900 Cr', role: 'Pays your monthly payout. Buys a share and sells its future at the same time, so it earns the price gap, not the market move.', seed: 3, drift: .006, vol: .002 },
    { n: 'Bandhan Small Cap Fund', tag: 'SMALL', c: '#58b858', w: .24, amt: 119994, cagr: [18.2, 27.5, 31.8], beta: 0.92, sd: 17.4, mdd: -26.1, ter: 0.36, aum: '₹12,400 Cr', role: 'The growth engine. Small companies swing hardest both ways — this is where most of the upside and most of the drawdown live.', seed: 7, drift: .022, vol: .05 },
    { n: 'Edelweiss Mid Cap Fund', tag: 'MID', c: '#6ac86a', w: .24, amt: 119994, cagr: [16.8, 25.9, 29.4], beta: 0.88, sd: 15.1, mdd: -22.6, ter: 0.38, aum: '₹11,100 Cr', role: 'Mid-sized companies that have proven the model but still have room to grow. Steadier than small caps, faster than large.', seed: 11, drift: .02, vol: .04 },
    { n: 'ICICI Pru Gold ETF FOF', tag: 'GOLD', c: '#e9c15c', w: .16, amt: 79996, cagr: [24.6, 21.3, 16.9], beta: -0.05, sd: 12.8, mdd: -9.7, ter: 0.09, aum: '₹3,200 Cr', role: 'The shock absorber. Gold has tended to rise when equities fall, so it cushions the bad years without dragging the good ones.', seed: 19, drift: .014, vol: .03 }
  ];
  function vrSeries(f, n) { var s = f.seed, v = 100, out = [v]; function rnd() { s = (s * 9301 + 49297) % 233280; return s / 233280; } for (var i = 1; i < n; i++) { v = v * (1 + f.drift + (rnd() - .5) * f.vol * 2); out.push(v); } return out; }
  function vrPath(arr, W, H, pad, min, max) { var n = arr.length; return arr.map(function (v, i) { return (i ? 'L' : 'M') + (pad + i * (W - 2 * pad) / (n - 1)).toFixed(1) + ' ' + (H - pad - (v - min) / (max - min) * (H - 2 * pad)).toFixed(1); }).join(''); }
  function vrSpark(f) { var a = vrSeries(f, 40), min = Math.min.apply(null, a), max = Math.max.apply(null, a); if (max - min < 1) { max = min + 1; } var d = vrPath(a, 300, 44, 2, min, max); return '<svg class="spark" viewBox="0 0 300 44" preserveAspectRatio="none"><path d="' + d + ' L298 44 L2 44 Z" fill="' + f.c + '" opacity=".12"></path><path d="' + d + '" fill="none" stroke="' + f.c + '" stroke-width="1.6" stroke-linejoin="round"></path></svg>'; }
  function vrBlend(n) { var series = VR_FUNDS.map(function (f) { return vrSeries(f, n); }); return series[0].map(function (_, i) { return VR_FUNDS.reduce(function (s, f, k) { return s + f.w * series[k][i]; }, 0); }); }
  function vrChart() {
    var W = 320, H = 150, pad = 6, n = 60, blend = vrBlend(n), eq = vrSeries({ seed: 5, drift: .018, vol: .06 }, n), base = 100 * Math.pow(1.0645, 5);
    var all = blend.concat(eq), min = Math.min.apply(null, all) * .98, max = Math.max.apply(null, all) * 1.02;
    var yBase = H - pad - (100 - min) / (max - min) * (H - 2 * pad);
    var grid = ''; for (var g = 1; g <= 3; g++) { var y = pad + g * (H - 2 * pad) / 4; grid += '<line x1="0" x2="' + W + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#2b2e3a" stroke-width="1"></line>'; }
    var pb = vrPath(blend, W, H, pad), pe = vrPath(eq, W, H, pad, min, max), last = blend[n - 1], lastE = eq[n - 1];
    pb = vrPath(blend, W, H, pad, min, max);
    return '<svg class="ch" viewBox="0 0 ' + W + ' ' + H + '">' + grid +
      '<line x1="0" x2="' + W + '" y1="' + yBase.toFixed(1) + '" y2="' + yBase.toFixed(1) + '" stroke="#3f424d" stroke-dasharray="3 4"></line>' +
      '<path d="' + pe + '" fill="none" stroke="#5c5f6e" stroke-width="1.5" stroke-dasharray="4 3"></path>' +
      '<path d="' + pb + ' L' + (W - pad) + ' ' + (H - pad) + ' L' + pad + ' ' + (H - pad) + ' Z" fill="url(#vrG)" opacity=".9"></path>' +
      '<path d="' + pb + '" fill="none" stroke="#b5abfc" stroke-width="2.2" stroke-linejoin="round"></path>' +
      '<circle cx="' + (W - pad) + '" cy="' + (H - pad - (last - min) / (max - min) * (H - 2 * pad)).toFixed(1) + '" r="4" fill="#b5abfc" stroke="#161826" stroke-width="2"></circle>' +
      '<defs><linearGradient id="vrG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c6fd6" stop-opacity=".35"></stop><stop offset="1" stop-color="#7c6fd6" stop-opacity="0"></stop></linearGradient></defs></svg>' +
      '<div class="vr-leg"><span><i style="background:#b5abfc"></i>This mix · ' + Math.round(last) + '</span><span><i style="background:#5c5f6e"></i>Nifty 50 · ' + Math.round(lastE) + '</span><span><i style="background:#3f424d"></i>Start · 100</span></div>';
  }
  var vrRange = '1Y', vrCtx = null;
  var VR_RANGES = { '1Y': [12, 0.0121], '3Y': [36, 0.0121], '5Y': [60, 0.0121] };
  function vrMain(range) {
    // one line: what ₹5L in this mix became while ₹1,500 was withdrawn every month — each withdrawal marked
    var W = 320, H = 120, pad = 8, padB = 18, n = VR_RANGES[range][0], inv = vrCtx.inv, pay = 1500, MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var series = VR_FUNDS.map(function (f) { return vrSeries({ seed: f.seed + n, drift: f.drift, vol: f.vol }, n + 1); });
    var val = [], v = inv;
    for (var i = 0; i <= n; i++) { if (i) { var g = VR_FUNDS.reduce(function (s2, f, j) { return s2 + f.w * (series[j][i] / series[j][i - 1] - 1); }, 0); v = v * (1 + g) - pay; } val.push(v); }
    var min = Math.min.apply(null, val) * .985, max = Math.max.apply(null, val) * 1.01, end = Math.round(val[n]), up = end >= inv, col = up ? '#8fd48f' : '#e0a0a0';
    var X = function (i) { return pad + i * (W - 2 * pad) / n; }, Y = function (y) { return H - padB - (y - min) / (max - min) * (H - padB - pad); };
    var d = val.map(function (y, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(y).toFixed(1); }).join('');
    var dots = '', labels = '', step = n <= 12 ? 1 : n <= 36 ? 6 : 12, startM = 9; // Oct is the first payout month
    for (var k = 1; k <= n; k++) { dots += '<circle cx="' + X(k).toFixed(1) + '" cy="' + Y(val[k]).toFixed(1) + '" r="' + (n <= 12 ? 3.2 : 1.8) + '" fill="#f6c445" stroke="#161826" stroke-width="1.2"></circle>'; }
    for (var m = 0; m <= n; m += step) { var mi = (startM - 1 + m) % 12, yr = Math.floor((startM - 1 + m) / 12); labels += '<text x="' + X(m).toFixed(1) + '" y="' + (H - 3) + '" text-anchor="' + (m === 0 ? 'start' : m === n ? 'end' : 'middle') + '" font-family="Inter, system-ui, sans-serif" font-size="8.5" fill="#6b6e79">' + (n <= 12 ? MON[mi] : (yr ? "'" + String(26 + yr).slice(-2) : MON[mi])) + '</text>'; }
    return '<div class="vr-chh"><div><span>' + lakhShort(inv) + ' in this mix, paying you ₹1,500 every month</span><b class="' + (up ? 'vr-up' : 'vr-dn') + '">' + inr(end) + '<em> today · ' + (up ? '+' : '') + ((end / inv - 1) * 100).toFixed(0) + '%</em></b></div></div>' +
      '<svg class="ch" viewBox="0 0 ' + W + ' ' + H + '"><line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + Y(inv).toFixed(1) + '" y2="' + Y(inv).toFixed(1) + '" stroke="#3f424d" stroke-dasharray="3 4"></line>' +
      '<path d="' + d + ' L' + X(n).toFixed(1) + ' ' + (H - padB) + ' L' + pad + ' ' + (H - padB) + ' Z" fill="' + col + '" opacity=".10"></path><path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.2" stroke-linejoin="round"></path>' + dots + labels + '</svg>' +
      '<div class="vr-leg"><span><i style="background:' + col + '"></i>Value</span><span><i style="background:#f6c445;width:8px;height:8px;border-radius:50%"></i>₹1,500 withdrawn · ' + n + ' times, ' + inr(pay * n) + '</span></div>' +
      '<div class="vr-rng">' + ['1Y', '3Y', '5Y'].map(function (x) { return '<button type="button"' + (x === range ? ' class="on"' : '') + ' data-rng="' + x + '">' + x + '</button>'; }).join('') + '</div>';
  }
  function villaOpen(cell) {
    var name = cell.dataset.name || 'Villa', idx = parseInt((name.match(/\d+/) || ['1'])[0], 10);
    var inv = 499975, k = idx === 3 ? -0.9 : (0.6 + 0.1 * idx);
    var since = [0.0011, 0.0264, 0.0218, 0.0189].map(function (p, j) { return j === 0 ? Math.abs(p * k) : p * k; });
    var gain = Math.round(VR_FUNDS.reduce(function (s2, f, j) { return s2 + f.amt * since[j]; }, 0)), valueNow = inv + gain, chg = gain / inv, up = gain >= 0;
    vrCtx = { inv: inv };
    document.getElementById('vrTitle').textContent = name; document.getElementById('vrSince').textContent = 'since 10 Sep';
    var h = '';
    h += '<div class="vr-head"><div class="vr-glow"></div><svg viewBox="14 2 212 184" aria-hidden="true"><use href="#tVilla"></use></svg>' +
      '<div class="vr-iv"><div class="c"><span>You invested</span><b>' + inr(inv) + '</b><em>10 Sep 2026</em></div><div class="mid"><i class="ln"></i><span class="pill ' + (up ? 'vr-up' : 'vr-dn') + '">' + (up ? '▲' : '▼') + ' ' + (up ? '+' : '') + (chg * 100).toFixed(1) + '%</span><i class="ln"></i></div><div class="c r"><span>Worth today</span><b class="' + (up ? 'vr-up' : 'vr-dn') + '">' + inr(valueNow) + '</b><em>' + (up ? '+' : '−') + inr(Math.abs(gain)) + ' ' + (up ? 'gained' : 'down') + '</em></div></div>' + (up ? '' : '<div class="vr-note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15c3-6 6-6 9 0s6 6 9 0"></path><path d="M3 9c3-6 6-6 9 0s6 6 9 0" opacity=".45"></path></svg><span><b>A dip is normal.</b> Markets move; your ₹1,500 a month keeps coming — it is paid from the arbitrage fund, which does not follow the market.</span></div>') + '</div>';
    h += '<div class="vr-card" id="vrChart">' + vrMain(vrRange) + '</div>';
    h += '<div class="vr-sec"><span>Pays you</span></div><div class="vr-pay"><div class="coin"><span>₹</span></div><div class="t"><b>₹1,500 <em>a month</em></b><span>Next credit 5 Oct · from your arbitrage fund</span></div></div>';
    h += '<div class="vr-sec"><span>Inside this villa</span><i>4 funds</i></div>';
    VR_FUNDS.forEach(function (f, j) { var p = since[j], g = Math.round(f.amt * p), now = f.amt + g, up2 = g >= 0, arb = f.tag === 'ARB', cls = up2 ? 'vr-up' : 'vr-dn';
      h += '<div class="vr-f' + (arb ? ' arb' : '') + '" style="--c:' + f.c + '">' +
        '<div class="vr-fh"><span class="tag">' + f.tag + '</span><div class="nm"><b>' + f.n.replace(' Fund', '').replace(' ETF FOF', '') + '</b><span>' + ({ ARB: 'Fuels your ₹1,500 a month', SMALL: 'Growth · small cap', MID: 'Growth · mid cap', GOLD: 'Cushion · gold' })[f.tag] + '</span></div><span class="pill ' + cls + '">' + (up2 ? '▲' : '▼') + ' ' + (up2 ? '+' : '') + (p * 100).toFixed(1) + '%</span></div>' +
        '<div class="iv"><div><span>Invested</span><b>' + inr(f.amt) + '</b></div><i class="arr">→</i><div class="r"><span>Now</span><b class="' + cls + '">' + inr(now) + '</b></div></div>' +
        '<div class="mv"><div class="bar"><i style="width:' + Math.min(100, 100 * f.amt / Math.max(f.amt, now)).toFixed(1) + '%"></i><i class="g ' + cls + '" style="width:' + Math.min(100, 100 * Math.abs(g) / Math.max(f.amt, now)).toFixed(1) + '%"></i></div><b class="' + cls + '">' + (up2 ? '+' : '−') + inr(Math.abs(g)) + '</b></div>' +
      '</div>'; });
    h += '<div class="vr-fine">Past returns are not a forecast. Payouts come from units and are not fixed or assured.</div>';
    document.getElementById('vrBody').innerHTML = h;
    document.getElementById('ap-villa').hidden = false; document.getElementById('vrBody').scrollTop = 0;
  }
  document.addEventListener('click', function (e) {
    var rg = e.target.closest('[data-rng]'); if (rg) { vrRange = rg.dataset.rng; document.getElementById('vrChart').innerHTML = vrMain(vrRange); }
  });
