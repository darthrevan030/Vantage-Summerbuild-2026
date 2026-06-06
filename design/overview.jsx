/* ===================================================================
   OVERVIEW TAB
=================================================================== */
(function () {
  const { useState } = React;
  const L = window.PL, D = window.PD;
  const { Donut, Legend, Dumbbell, Icon, sgd, sgdSigned, pct } = L;

  function MoverRow({ m, scale, open, onToggle }) {
    const total = m.asset + m.fx;
    const pos = total >= 0;
    return (
      <div className={'mover' + (open ? ' open' : '')}>
        <button className="mover-row" onClick={onToggle}>
          <div className="mv-name">
            <span className="ui">{m.name}</span>
            <span className="mono ticker">{m.ticker}</span>
          </div>
          <Dumbbell asset={m.asset} fx={m.fx} scale={scale} />
          <span className="mono mv-pct" style={{ color: pos ? 'var(--gain)' : 'var(--loss)' }}>{pct(total)}</span>
          <Icon name="chevron" size={14} className="mv-chev" />
        </button>
        {open && (
          <div className="mv-drawer">
            <div className="math-row"><span className="ui">Asset return</span><span className="mono" style={{ color: m.asset >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{pct(m.asset)}</span></div>
            <div className="math-row"><span className="ui">FX effect</span><span className="mono" style={{ color: m.fx >= 0 ? 'var(--fx-positive)' : 'var(--fx-negative)' }}>{m.fx === 0 ? '—' : pct(m.fx)}</span></div>
            <div className="math-row total"><span className="ui">Total return</span><span className="mono" style={{ color: pos ? 'var(--gain)' : 'var(--loss)' }}>{pct(total)}</span></div>
            <div className="mv-note ui">
              {m.fx > 0 ? 'Currency tailwind added to the asset move.' : m.fx < 0 ? 'Currency partially offset the asset move.' : 'SGD-denominated — no FX effect.'}
            </div>
          </div>
        )}
      </div>
    );
  }

  function MoverColumn({ title, list, tone }) {
    const [open, setOpen] = useState(null);
    const scale = Math.max(...[...D.movers.gainers, ...D.movers.losers].map(m => Math.abs(m.asset + m.fx)));
    return (
      <div className="card movers-col">
        <div className="card-head">
          <span className="card-title">{title}</span>
          <Icon name={tone === 'up' ? 'up' : 'down'} size={15} style={{ color: tone === 'up' ? 'var(--gain)' : 'var(--loss)' }} />
        </div>
        <div className="movers-list">
          {list.map((m, i) => (
            <MoverRow key={i} m={m} scale={scale} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
          ))}
        </div>
      </div>
    );
  }

  function Overview() {
    const ac = D.assetClass, acTop = ac[0];
    const geo = D.geography, geoTop = geo[0];
    const h = D.hero;
    const assetGain = h.totalGain - h.fxImpact;
    return (
      <div className="tab-body">
        {/* hero stats — folded in from the summary rail */}
        <div className="stat-row reveal">
          <div className="stat-card accent">
            <span className="stat-label">Total Value</span>
            <span className="mono stat-value">{sgd(h.total, 2)}</span>
            <span className="ui stat-sub muted">Personal wealth</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Total Gain</span>
            <span className="mono stat-value" style={{ color: 'var(--gain)' }}>{sgdSigned(h.totalGain)}</span>
            <span className="mono stat-sub" style={{ color: 'var(--gain)' }}>{pct(h.totalGainPct)}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">FX Impact</span>
            <span className="mono stat-value" style={{ color: 'var(--fx-positive)' }}>{sgdSigned(h.fxImpact)}</span>
            <span className="mono stat-sub" style={{ color: 'var(--fx-positive)' }}>{pct(h.fxPct)}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Today</span>
            <span className="mono stat-value" style={{ color: 'var(--gain)' }}>{sgdSigned(h.dayChange)}</span>
            <span className="mono stat-sub" style={{ color: 'var(--gain)' }}>{pct(h.dayPct)}</span>
          </div>
        </div>

        {/* two donuts */}
        <div className="ov-grid reveal" style={{ animationDelay: '.05s' }}>
          <div className="card">
            <div className="card-head"><span className="card-title">By Asset Class</span><span className="ui muted">allocation</span></div>
            <div className="donut-block">
              <Donut data={ac} size={150} thickness={22}>
                <div><div className="ui muted xs">{acTop.label}</div><div className="mono donut-pct">{acTop.value}%</div></div>
              </Donut>
              <Legend data={ac} />
            </div>
          </div>
          <div className="card">
            <div className="card-head"><span className="card-title">By Geography</span><span className="ui muted">exposure</span></div>
            <div className="donut-block">
              <Donut data={geo} size={150} thickness={22}>
                <div><div className="ui muted xs">{geoTop.label}</div><div className="mono donut-pct">{geoTop.value}%</div></div>
              </Donut>
              <Legend data={geo} />
            </div>
          </div>
        </div>

        {/* return attribution */}
        <div className="card reveal" style={{ animationDelay: '.1s' }}>
          <div className="card-head"><span className="card-title">Return Attribution</span><span className="ui muted">life-to-date · asset vs currency</span></div>
          <div className="attr">
            <div className="attr-bar">
              <div className="ab-seg" style={{ flex: assetGain, background: 'var(--gain)' }} />
              <div className="ab-seg" style={{ flex: h.fxImpact, background: 'var(--fx-positive)' }} />
            </div>
            <div className="attr-rows">
              <div className="attr-item"><i style={{ background: 'var(--gain)' }} /><div><div className="ui muted xs">Asset gain</div><div className="mono attr-v" style={{ color: 'var(--gain)' }}>{sgdSigned(assetGain)}</div></div></div>
              <div className="attr-item"><i style={{ background: 'var(--fx-positive)' }} /><div><div className="ui muted xs">FX gain</div><div className="mono attr-v" style={{ color: 'var(--fx-positive)' }}>{sgdSigned(h.fxImpact)}</div></div></div>
              <div className="attr-item total"><div><div className="ui muted xs">Total gain</div><div className="mono attr-v">{sgdSigned(h.totalGain)} <span style={{ color: 'var(--gain)' }}>{pct(h.totalGainPct)}</span></div></div></div>
            </div>
          </div>
        </div>

        {/* movers */}
        <div className="movers-grid reveal" style={{ animationDelay: '.15s' }}>
          <MoverColumn title="Top Gainers" list={D.movers.gainers} tone="up" />
          <MoverColumn title="Top Losers" list={D.movers.losers} tone="down" />
        </div>

        {/* fx pills */}
        <div className="card reveal" style={{ animationDelay: '.2s' }}>
          <div className="card-head"><span className="card-title">Currency Impact</span><span className="ui muted">FX P&amp;L by exposure</span></div>
          <div className="fx-pills">
            {D.currencies.map((c) => (
              <div className="fx-pill" key={c.code}>
                <span className="flag">{c.flag}</span>
                <span className="mono code">{c.code}</span>
                <span className="mono pill-val" style={{ color: c.impact >= 0 ? 'var(--fx-positive)' : 'var(--fx-negative)' }}>{sgdSigned(c.impact)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  window.Panels = Object.assign(window.Panels || {}, { Overview });
})();
