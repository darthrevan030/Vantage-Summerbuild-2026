/* ===================================================================
   PORTFOLIO TERMINAL — hardcoded data (design-only, no fetching)
   Exposed as window.PD
=================================================================== */
(function () {
  // ---- segment palette (custom, not default chart colors) ----
  const PAL = ['#b79cff', '#5fd0c6', '#6fb0ff', '#f4a6cf', '#8b8bff', '#f0bd8a'];

  const hero = {
    total: 1284720.44,
    dayChange: 27103.20,
    dayPct: 2.14,
    totalGain: 184230.80,
    totalGainPct: 16.74,
    fxImpact: 12840.30,
    fxPct: 1.01,
    neutral: 1271880.14,
    updated: '14:23 SGT',
  };

  const assetClass = [
    { label: 'Equities', value: 42, color: PAL[0] },
    { label: 'REITs', value: 18, color: PAL[1] },
    { label: 'Real Estate', value: 14, color: PAL[2] },
    { label: 'ETFs', value: 12, color: PAL[3] },
    { label: 'Gold', value: 8, color: PAL[4] },
    { label: 'Other', value: 6, color: PAL[5] },
  ];

  const geography = [
    { label: 'United States', value: 38, color: PAL[0] },
    { label: 'Singapore', value: 32, color: PAL[1] },
    { label: 'Europe', value: 16, color: PAL[2] },
    { label: 'Global', value: 14, color: PAL[3] },
  ];

  // ---- the 5 fully-fleshed holdings (Holdings table) ----
  const holdings = [
    {
      ticker: 'AAPL', name: 'Apple Inc.', type: 'Equity', broker: 'Tiger',
      strategy: 'long_term', units: '50 sh', ccy: 'USD', flag: '🇺🇸', icon: 'briefcase',
      costSGD: 9242, valueSGD: 14250, assetGain: 5226, fxGain: -218, totalPct: 54.2,
      detail: { buyUnits: 50, buyPx: 136.20, buyDate: '2022-08-14', buyFx: 1.3842, curPx: 213.50, curFx: 1.3520, ccy: 'USD' },
      spark: [136, 129, 142, 151, 148, 160, 171, 168, 182, 190, 186, 199, 205, 213.5],
    },
    {
      ticker: 'CICT', name: 'CapitaLand Int Comm', type: 'REIT', broker: 'DBS',
      strategy: 'long_term', units: '8,000 u', ccy: 'SGD', flag: '🇸🇬', icon: 'landmark',
      costSGD: 14400, valueSGD: 15680, assetGain: 1280, fxGain: 0, totalPct: 8.9,
      detail: { buyUnits: 8000, buyPx: 1.80, buyDate: '2021-11-03', buyFx: 1.0, curPx: 1.96, curFx: 1.0, ccy: 'SGD' },
      spark: [1.80, 1.74, 1.69, 1.72, 1.81, 1.88, 1.84, 1.91, 1.95, 1.93, 1.96],
    },
    {
      ticker: 'IWDA', name: 'iShares MSCI World', type: 'ETF', broker: 'Saxo',
      strategy: 'long_term', units: '200 sh', ccy: 'USD', flag: '🇺🇸', icon: 'layers',
      costSGD: 47310, valueSGD: 58240, assetGain: 11620, fxGain: -690, totalPct: 23.1,
      detail: { buyUnits: 200, buyPx: 171.10, buyDate: '2022-02-18', buyFx: 1.3690, curPx: 215.40, curFx: 1.3520, ccy: 'USD' },
      spark: [171, 166, 159, 168, 177, 184, 180, 191, 198, 203, 209, 215.4],
    },
    {
      ticker: '—', name: 'Physical Gold (5oz)', type: 'Gold', broker: 'Physical',
      strategy: 'physical', units: '5 oz', ccy: 'USD', flag: '🇺🇸', icon: 'gem',
      costSGD: 12300, valueSGD: 18450, assetGain: 6420, fxGain: -270, totalPct: 50.0,
      detail: { buyUnits: 5, buyPx: 1776.00, buyDate: '2020-09-22', buyFx: 1.3720, curPx: 2730.00, curFx: 1.3520, ccy: 'USD' },
      spark: [1776, 1810, 1690, 1850, 1920, 2010, 1980, 2150, 2340, 2510, 2680, 2730],
    },
    {
      ticker: '—', name: 'Punggol EC', type: 'RE', broker: 'Physical',
      strategy: 'physical', units: '1 unit', ccy: 'SGD', flag: '🇸🇬', icon: 'building',
      costSGD: 600000, valueSGD: 720000, assetGain: 120000, fxGain: 0, totalPct: 20.0,
      detail: { buyUnits: 1, buyPx: 600000, buyDate: '2019-06-10', buyFx: 1.0, curPx: 720000, curFx: 1.0, ccy: 'SGD' },
      spark: [600, 612, 628, 640, 655, 668, 681, 695, 702, 711, 720],
    },
  ];

  // ---- movers (overview) — asset & fx split, total = asset+fx ----
  const movers = {
    gainers: [
      { name: 'Apple Inc.', ticker: 'AAPL', asset: 56.5, fx: -2.3 },
      { name: 'Physical Gold', ticker: '5OZ', asset: 52.2, fx: -2.2 },
      { name: 'iShares World', ticker: 'IWDA', asset: 24.6, fx: -1.5 },
      { name: 'Punggol EC', ticker: 'PGEC', asset: 20.0, fx: 0 },
      { name: 'ASML Holding', ticker: 'ASML', asset: 15.1, fx: 3.3 },
    ],
    losers: [
      { name: 'Alibaba Group', ticker: 'BABA', asset: -14.8, fx: 2.2 },
      { name: 'ARK Innovation', ticker: 'ARKK', asset: -10.1, fx: 0.8 },
      { name: 'Zoom Video', ticker: 'ZM', asset: -6.0, fx: -1.1 },
      { name: 'Grab Holdings', ticker: 'GRAB', asset: -4.8, fx: 0 },
      { name: 'Rivian Auto', ticker: 'RIVN', asset: -1.9, fx: -1.3 },
    ],
  };

  // ---- currency pills / FX lab cards ----
  const currencies = [
    { code: 'USD', flag: '🇺🇸', exposure: 684200, exposurePct: 53.3, avg: 1.3740, cur: 1.3520, deltaPct: -1.60, impact: -8640, dir: 'neg',
      spark: [1.374, 1.371, 1.368, 1.372, 1.366, 1.359, 1.363, 1.357, 1.352, 1.349, 1.352] },
    { code: 'EUR', flag: '🇪🇺', exposure: 235000, exposurePct: 18.3, avg: 1.4120, cur: 1.4480, deltaPct: 2.55, impact: 9820, dir: 'pos',
      spark: [1.412, 1.418, 1.421, 1.415, 1.428, 1.436, 1.431, 1.442, 1.447, 1.444, 1.448] },
    { code: 'AUD', flag: '🇦🇺', exposure: 168000, exposurePct: 13.1, avg: 0.8650, cur: 0.8820, deltaPct: 1.97, impact: 6310, dir: 'pos',
      spark: [0.865, 0.861, 0.868, 0.872, 0.866, 0.874, 0.879, 0.871, 0.878, 0.880, 0.882] },
    { code: 'INR', flag: '🇮🇳', exposure: 142000, exposurePct: 11.1, avg: 0.01560, cur: 0.01605, deltaPct: 2.88, impact: 5350, dir: 'pos',
      spark: [0.01560, 0.01566, 0.01572, 0.01568, 0.01579, 0.01588, 0.01581, 0.01594, 0.01601, 0.01598, 0.01605] },
  ];

  // ---- portfolio value over time (Jan 2023 -> Jun 2026 = 42 mo) ----
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const portfolioSeries = [];
  {
    const start = 1031000, end = hero.total;
    let yr = 2023, mo = 0;
    for (let i = 0; i < 42; i++) {
      const t = i / 41;
      const trend = start + (end - start) * (t * 0.55 + Math.pow(t, 1.7) * 0.45);
      const wob = Math.sin(i * 0.7) * 11000 + Math.sin(i * 1.9 + 1) * 6000 + Math.sin(i * 0.33) * 8000;
      let v = Math.round((trend + wob) / 100) * 100;
      portfolioSeries.push({ label: `${MON[mo]} ${String(yr).slice(2)}`, v });
      mo++; if (mo > 11) { mo = 0; yr++; }
    }
    portfolioSeries[portfolioSeries.length - 1].v = Math.round(end);
  }

  // ---- FX contribution over time (cumulative, per currency) ----
  const fxSeries = [];
  {
    const finals = { usd: -8640, eur: 9820, aud: 6310, inr: 5350 };
    for (let i = 0; i < 42; i++) {
      const t = i / 41;
      const ease = t * t * (3 - 2 * t); // smoothstep
      const wob = (k) => Math.sin(i * 0.6 + k) * (Math.abs(finals[Object.keys(finals)[k]]) * 0.07);
      fxSeries.push({
        i,
        usd: Math.round(finals.usd * ease + wob(0)),
        eur: Math.round(finals.eur * ease + wob(1)),
        aud: Math.round(finals.aud * ease + wob(2)),
        inr: Math.round(finals.inr * ease + wob(3)),
      });
    }
    const last = fxSeries[fxSeries.length - 1];
    last.usd = finals.usd; last.eur = finals.eur; last.aud = finals.aud; last.inr = finals.inr;
  }

  // chart-tab currency colors (per spec: USD blue, EUR teal, AUD amber, INR purple)
  const fxColors = { usd: '#6fb0ff', eur: '#46d8a0', aud: '#f0bd8a', inr: '#b79cff' };

  // waterfall (FX Lab) — sums to net fx impact
  const waterfall = [
    { code: 'USD', value: -8640, dir: 'neg' },
    { code: 'EUR', value: 9820, dir: 'pos' },
    { code: 'AUD', value: 6310, dir: 'pos' },
    { code: 'INR', value: 5350, dir: 'pos' },
  ];

  window.PD = { PAL, hero, assetClass, geography, holdings, movers, currencies, portfolioSeries, fxSeries, fxColors, waterfall };
})();
