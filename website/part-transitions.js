(function () {
  if (window.tdcVeil) return;
  var KEY = 'tdcVeil';
  var BG = 'radial-gradient(ellipse 45% 50% at 50% 45%,rgba(246,196,69,.16),transparent 70%),radial-gradient(ellipse 50% 30% at 50% 100%,rgba(42,43,107,.6),transparent 70%),linear-gradient(180deg,#0c0e24,#0a0b16)';
  var EASE = 'cubic-bezier(.7,0,.3,1)';
  if (!document.getElementById('tdcVeilKf')) {
    var st = document.createElement('style'); st.id = 'tdcVeilKf';
    st.textContent = '@keyframes tdcVeilSpin{0%{transform:scaleX(1)}50%{transform:scaleX(.12)}100%{transform:scaleX(1)}}';
    (document.head || document.documentElement).appendChild(st);
  }
  function build(o, open) {
    var cx = o.cx || '50%', cy = o.cy || '50%';
    var v = document.createElement('div');
    v.setAttribute('data-tdc-veil', '1');
    v.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;pointer-events:auto;background:' + BG + ';will-change:clip-path;transition:clip-path 1s ' + EASE + ';clip-path:circle(' + (open ? '150%' : '0%') + ' at ' + cx + ' ' + cy + ');font-family:Inter,system-ui,sans-serif';
    v.innerHTML =
      '<div style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,236,190,.16) 1px,transparent 1.2px);background-size:28px 28px;-webkit-mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 30%,transparent 90%);mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 30%,transparent 90%)"></div>' +
      '<div data-l="1" style="position:relative;display:flex;flex-direction:column;align-items:center;gap:18px;opacity:' + (open ? 1 : 0) + ';transform:scale(' + (open ? 1 : .86) + ');transition:opacity .45s ease,transform .7s cubic-bezier(.2,.8,.2,1)">' +
        '<div style="width:18vh;height:18vh;border-radius:50%;background:radial-gradient(circle at 34% 26%,#fff4c8 0%,#fbdb81 18%,#f6c445 45%,#d8961f 78%,#9a5f0c 100%);box-shadow:inset 0 0 0 .5vh #d8961f,inset 0 0 0 .65vh #9a5f0c,inset 0 -1.2vh 3vh rgba(90,50,0,.4),0 0 80px 20px rgba(246,196,69,.25);display:grid;place-items:center;animation:tdcVeilSpin 1.6s cubic-bezier(.45,0,.55,1) infinite"><span style="font-size:6vh;font-weight:600;color:#8a5208;text-shadow:0 1px 0 rgba(255,240,200,.6)">' + (o.num || '') + '</span></div>' +
        '<span style="font-size:11px;letter-spacing:.32em;color:#f6c445">' + (o.kicker || '') + '</span>' +
        '<span style="font-size:clamp(28px,3.6vw,52px);font-weight:500;letter-spacing:-.04em;line-height:1;color:#fff6ea;text-align:center">' + (o.title || '') + '</span>' +
      '</div>';
    (document.body || document.documentElement).appendChild(v);
    return v;
  }
  var SKY = 'linear-gradient(180deg,#0c0f2c 0%,#2a2862 30%,#73467c 54%,#d9814f 76%,#f3bd7c 100%)';
  function sky(op) {
    var v = document.createElement('div');
    v.setAttribute('data-tdc-veil', '1');
    v.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:auto;background:' + SKY + ';opacity:' + op + ';will-change:opacity;transition:opacity .55s cubic-bezier(.45,0,.2,1)';
    (document.body || document.documentElement).appendChild(v);
    return v;
  }
  function go(url, o) {
    if (window.__tdcLeaving) return; window.__tdcLeaving = true;
    if (o && o.style === 'sky') {
      var s = sky(0); if (o.fast) s.style.transition = 'opacity .18s ease-out'; s.getBoundingClientRect();
      requestAnimationFrame(function () { requestAnimationFrame(function () { s.style.opacity = '1'; }); });
      try { sessionStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
      setTimeout(function () { location.href = url; }, o.fast ? 180 : 600);
      return;
    }
    var v = build(o, false), l = v.querySelector('[data-l]');
    v.getBoundingClientRect();
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      v.style.clipPath = 'circle(150% at ' + (o.cx || '50%') + ' ' + (o.cy || '50%') + ')';
      setTimeout(function () { l.style.opacity = '1'; l.style.transform = 'none'; }, 380);
    }); });
    try { sessionStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
    setTimeout(function () { location.href = url; }, 1250);
  }
  function arrive() {
    var raw = null; try { raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch (e) {}
    if (!raw) return;
    var o = {}; try { o = JSON.parse(raw); } catch (e) {}
    if (o.style === 'sky') {
      document.documentElement.setAttribute('data-tdc-arrive', 'sky');
      var s = sky(1), t1 = Date.now();
      if (o.anchor) { var jump = function () { var a = document.getElementById(o.anchor); if (a && a.parentElement) { a.parentElement.scrollTop = a.offsetTop; return true; } }; if (!jump()) { var n = 0, iv = setInterval(function () { if (jump() || ++n > 40) clearInterval(iv); }, 25); } }
      var done = false, fade = function () { if (done) return; done = true; s.style.pointerEvents = 'none'; s.style.transition = o.fast ? 'opacity .3s ease-out' : 'opacity .8s cubic-bezier(.4,0,.2,1)'; s.style.opacity = '0'; setTimeout(function () { s.remove(); }, 900); };
      setTimeout(fade, o.fast ? 0 : 350); addEventListener('load', fade);
      return;
    }
    var v = build({ num: o.num, kicker: o.kicker, title: o.title, cx: '50%', cy: '50%' }, true), l = v.querySelector('[data-l]');
    var t0 = Date.now();
    function reveal() {
      if (o.anchor) { var a = document.getElementById(o.anchor); if (a && a.parentElement) a.parentElement.scrollTop = a.offsetTop; }
      l.style.opacity = '0'; l.style.transform = 'scale(.92)';
      setTimeout(function () {
        v.style.pointerEvents = 'none';
        v.style.transition = 'clip-path 1.05s ' + EASE;
        v.style.clipPath = 'circle(0% at 50% 50%)';
        setTimeout(function () { v.remove(); }, 1150);
      }, 300);
    }
    function ready() { setTimeout(reveal, Math.max(0, 900 - (Date.now() - t0))); }
    if (document.readyState === 'complete') ready(); else addEventListener('load', ready);
  }
  function prefetch(urls) {
    var run = function () { urls.forEach(function (u) { var l = document.createElement('link'); l.rel = 'prefetch'; l.href = u; document.head.appendChild(l); }); };
    if (document.readyState === 'complete') setTimeout(run, 300); else addEventListener('load', function () { setTimeout(run, 300); });
  }
  window.tdcVeil = { go: go, prefetch: prefetch };
  arrive();
})();
