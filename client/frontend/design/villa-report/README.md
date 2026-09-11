## Villa report (`#ap-villa`) — opens when a BUILT villa is tapped
Source: `villa-report/` (markup shell, CSS, JS excerpted; the template is the truth). Cell click routing: `state === 'villa' → villaOpen(cell)`, everything else → the SIP/level page.

Content, in this exact order — nothing else:
1. **Header** `.vr-head`: villa centred (`<svg viewBox="14 2 212 184"><use href="#tVilla">` — full symbol box so roof and plinth are never chopped, 138×120, NO float animation) over a soft green glow. Under it `.vr-iv`: **You invested ₹4,99,975 · 10 Sep 2026** → coloured ▲/▼ % pill on a connector → **Worth today ₹5,08,218 · +₹8,243 gained**. When the villa is below cost, `.vr-note` appears INSIDE the header: "A dip is normal. Markets move; your ₹1,500 a month keeps coming — paid from the arbitrage fund, which does not follow the market."
2. **Chart** `#vrChart` — always the second element. ONE line: what ₹5L in this mix became while ₹1,500 was withdrawn every month. Every withdrawal is a gold dot on the line; month labels on the x-axis (Oct, Nov… for 1Y; years for 3Y/5Y); dashed line = amount put in. Legend: "Value · ₹1,500 withdrawn · 12 times, ₹18,000". Range tabs 1Y / 3Y / 5Y. Series are seeded random walks per fund (`vrSeries`) blended by weight — replace with real NAV history.
3. **Pays you** `.vr-pay` — gold coin, ₹1,500 a month, next credit date, "from your arbitrage fund".
4. **Inside this villa · 4 funds** — one `.vr-f` card per fund: header (`.vr-fh`: type tag, name, role, ▲/▼ % pill) · **Invested → Now** in rupees (Now coloured) · movement bar (invested in fund colour, gain/loss segment green/red) + ₹ moved. Arbitrage card is gold-tinted, role reads "Fuels your ₹1,500 a month". Per-fund gains SUM to the header gain (`gain = Σ amt × since`).
5. One fine-print line.

Data: `VR_FUNDS` (Kotak Arbitrage 36%, Bandhan Small 24%, Edelweiss Mid 24%, ICICI Gold 16% = the real ₹4,99,975 lumpsum). `since[]` is the per-fund % move since 10 Sep; Villa 03 is seeded negative so the down state is visible.

Rules: minimal numbers — no CAGR/beta/TER on this page; green/red only for up/down; every class is `vr-` namespaced (`.hd`, `.up`, `.chip`, `.flow` all collide with other screens — never reuse them).
