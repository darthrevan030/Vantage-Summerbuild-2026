/* ===================================================================
   FX LAB TAB — actual vs FX-neutral, currency cards, waterfall
=================================================================== */
(function () {
  const L = window.PL, D = window.PD;
  const { Icon, Spark, useCountUp, sgd, sgdSigned, pct, rate, NF } = L;

  function CcyCard({ c, delay }) {
    const pos = c.impact >= 0;
    const col = pos ? 'var(--fx-positive)' : 'var(--fx-negative)';
    return (
      <div className="card ccy-card reveal" style={{ animationDelay: delay }}>
        <div className="cc-head">
          <span className="cc-title"><span className="flag big">{c.flag}</span><span className="mono code">{c.code}</span></span>
          <span className="mono cc-delta" style={{ color: col }}>{pos ? '▲' : '▼'} {pct(c.deltaPct)}</span>
        </div>
        <div className="cc-grid">
          <div><div className="ui muted xs">Exposure</div><div className="mono cc-v">{sgd(c.exposure)}</div><div className="ui muted xs">{c.exposurePct}% of book</div></div>
          <div><div className="ui muted xs">Avg / Current</div><div className="mono cc-v">{rate(c.avg)} → {rate(c.cur)}</div><div className="ui muted xs">SGD per {c.code}</div></div>
        </div>
        <div className="cc-foot">
          <div><div className="ui muted xs">FX Impact</div><div className="mono cc-impact" style={{ color: col }}>{sgdSigned(c.impact)}</div></div>
          <div className="cc-spark"><Spark pts={c.spark} color={col} w={132} h={40} /></div>
        </div>
      </div>
    );
  }

  function Waterfall() {
    const items = D.waterfall;
    const max = Math.max(...items.map(i => Math.abs(i.value)));
    return (
      <div className="card reveal" style={{ animationDelay: '.28s' }}>
        <div className="card-head"><span className="card-title">Currency Contribution to Portfolio</span><span className="ui muted">SGD</span></div>
        <div className="waterfall">
          {items.map((it) => {
            const pos = it.value >= 0;
            const w = (Math.abs(it.value) / max) * 50;
            return (
              <div className="wf-row" key={it.code}>
                <span className="mono wf-code">{it.code}</span>
                <div className="wf-track">
                  <div className="wf-zero" />
                  <div className="wf-bar" style={{ [pos ? 'left' : 'right']: '50%', width: w + '%', background: pos ? 'var(--fx-positive)' : 'var(--fx-negative)' }} />
                </div>
                <span className="mono wf-val" style={{ color: pos ? 'var(--fx-positive)' : 'var(--fx-negative)' }}>{sgdSigned(it.value)}</span>
              </div>
            );
          })}
          <div className="wf-net">
            <span className="ui muted">Net FX effect</span>
            <span className="mono" style={{ color: 'var(--fx-positive)' }}>{sgdSigned(D.hero.fxImpact)} <span className="muted">({pct(D.hero.fxPct)})</span></span>
          </div>
        </div>
      </div>
    );
  }

  function FXLab() {
    const actual = useCountUp(D.hero.total, 1100);
    const neutral = useCountUp(D.hero.neutral, 1100);
    return (
      <div className="tab-body">
        {/* versus banner */}
        <div className="versus reveal">
          <div className="vs-side">
            <div className="ui muted label">Actual Portfolio</div>
            <div className="serif vs-num">{sgd(actual)}</div>
          </div>
          <div className="vs-mid">
            <div className="vs-vs ui">vs</div>
          </div>
          <div className="vs-side right">
            <div className="ui muted label">FX-Neutral Portfolio</div>
            <div className="serif vs-num dim">{sgd(neutral)}</div>
          </div>
          <div className="vs-verdict">
            <Icon name="up" size={16} style={{ color: 'var(--fx-positive)' }} />
            <span className="ui">Currency has added <b className="mono" style={{ color: 'var(--fx-positive)' }}>{sgdSigned(D.hero.fxImpact)}</b> <span className="mono" style={{ color: 'var(--fx-positive)' }}>({pct(D.hero.fxPct)})</span> to your returns</span>
          </div>
        </div>

        {/* currency cards */}
        <div className="ccy-grid">
          {D.currencies.map((c, i) => <CcyCard key={c.code} c={c} delay={(0.06 + i * 0.05) + 's'} />)}
        </div>

        <Waterfall />
      </div>
    );
  }

  window.Panels = Object.assign(window.Panels || {}, { FXLab });
})();
