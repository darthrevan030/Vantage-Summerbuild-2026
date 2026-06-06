/* ===================================================================
   CHARTS TAB — 2x2 grid
=================================================================== */
(function () {
  const { useState } = React;
  const L = window.PL, D = window.PD;
  const { Donut, Legend, AreaTrend, FXArea, sgd, sgdSigned, pct } = L;

  function PerfBars() {
    const rows = D.holdings.map(h => ({ name: h.name, ticker: h.ticker, pct: h.totalPct }))
      .sort((a, b) => b.pct - a.pct);
    const max = Math.max(...rows.map(r => Math.abs(r.pct)));
    return (
      <div className="perf">
        {rows.map((r, i) => {
          const pos = r.pct >= 0;
          const w = (Math.abs(r.pct) / max) * 100;
          return (
            <div className="perf-row" key={i}>
              <span className="ui perf-name">{r.name}</span>
              <div className="perf-track">
                <div className="perf-bar" style={{ width: w + '%', background: pos ? 'var(--gain)' : 'var(--loss)' }} />
              </div>
              <span className="mono perf-pct" style={{ color: pos ? 'var(--gain)' : 'var(--loss)' }}>{pct(r.pct)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  function PortfolioTrend() {
    const RANGES = [['6M', 6], ['1Y', 12], ['3Y', 36], ['All', 999]];
    const [ri, setRi] = useState(1);
    const full = D.portfolioSeries;
    const n = Math.min(RANGES[ri][1], full.length);
    const data = full.slice(full.length - n);
    const first = data[0], last = data[data.length - 1];
    const chg = last.v - first.v;
    const chgPct = (chg / first.v) * 100;
    const pos = chg >= 0;
    return (
      <div className="card chart-card reveal" style={{ animationDelay: '.04s' }}>
        <div className="card-head">
          <span className="card-title">Portfolio Value Over Time</span>
          <div className="rsel">
            {RANGES.map(([lab], i) => (
              <button key={lab} className={'rseg' + (i === ri ? ' active' : '')} onClick={() => setRi(i)}>{lab}</button>
            ))}
          </div>
        </div>
        <div className="trend-meta">
          <span className="ui muted xs">{first.label} – {last.label}</span>
          <span className="mono xs" style={{ color: pos ? 'var(--gain)' : 'var(--loss)' }}>{sgdSigned(chg)} ({pct(chgPct)})</span>
        </div>
        <AreaTrend key={ri} data={data} color="var(--gold)" height={232} valFmt={(v) => sgd(v)} />
      </div>
    );
  }

  function Charts() {
    const [hl, setHl] = useState(0);
    const ac = D.assetClass;
    return (
      <div className="tab-body">
        <div className="charts-grid">
          {/* portfolio value over time */}
          <PortfolioTrend />

          {/* allocation donut */}
          <div className="card chart-card reveal" style={{ animationDelay: '.09s' }}>
            <div className="card-head"><span className="card-title">Asset Allocation</span><span className="ui muted">click to isolate</span></div>
            <div className="donut-block lg">
              <Donut data={ac} size={190} thickness={30} highlight={hl} onSlice={(i) => setHl(i === hl ? -1 : i)}>
                <div>
                  <div className="ui muted xs">{hl >= 0 ? ac[hl].label : 'Total'}</div>
                  <div className="mono donut-pct">{hl >= 0 ? ac[hl].value + '%' : sgd(D.hero.total / 1000) + 'k'}</div>
                </div>
              </Donut>
              <Legend data={ac} highlight={hl} onItem={(i) => setHl(i === hl ? -1 : i)} />
            </div>
          </div>

          {/* per-asset performance */}
          <div className="card chart-card reveal" style={{ animationDelay: '.14s' }}>
            <div className="card-head"><span className="card-title">Per-Asset Performance</span><span className="ui muted">total return %</span></div>
            <PerfBars />
          </div>

          {/* fx impact over time */}
          <div className="card chart-card reveal" style={{ animationDelay: '.19s' }}>
            <div className="card-head"><span className="card-title">FX Impact Over Time</span><span className="ui muted">cumulative, SGD</span></div>
            <FXArea data={D.fxSeries} colors={D.fxColors} keys={['usd', 'eur', 'aud', 'inr']} height={210} />
            <div className="fx-legend">
              {[['USD', 'usd'], ['EUR', 'eur'], ['AUD', 'aud'], ['INR', 'inr']].map(([lab, k]) => (
                <span key={k}><i style={{ background: D.fxColors[k] }} /><span className="ui">{lab}</span></span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.Panels = Object.assign(window.Panels || {}, { Charts });
})();
