/* ===================================================================
   HOLDINGS TAB — table + multi-card compare tray
=================================================================== */
(function () {
  const { useState } = React;
  const L = window.PL, D = window.PD;
  const { Icon, Spark, sgd, sgdSigned, pct, rate } = L;

  const STRAT = {
    long_term: { label: 'long-term', cls: 'st-teal' },
    active: { label: 'active', cls: 'st-amber' },
    speculative: { label: 'speculative', cls: 'st-purple' },
    physical: { label: 'physical', cls: 'st-gray' },
  };
  const TYPES = ['All', 'Equity', 'ETF', 'REIT', 'Gold', 'RE'];

  function DetailCard({ h, onClose }) {
    const d = h.detail;
    const assetGainNative = (d.curPx - d.buyPx) * d.buyUnits;
    const total = h.assetGain + h.fxGain;
    return (
      <div className="detail-card reveal">
        <div className="dc-head">
          <div className="dc-id">
            <Icon name={h.icon} size={18} style={{ color: 'var(--gold)' }} />
            <div>
              <div className="ui dc-name">{h.name}</div>
              <div className="mono ticker">{h.ticker !== '—' ? h.ticker : h.type.toUpperCase()}</div>
            </div>
          </div>
          <button className="dc-close" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>
        <div className="dc-hero">
          <div className="mono dc-total" style={{ color: total >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{sgdSigned(total)}</div>
          <div className="mono dc-pct" style={{ color: total >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{pct(h.totalPct)}</div>
          <span className="ccy-chip"><span className="flag">{h.flag}</span><span className="mono">{h.ccy}</span></span>
        </div>
        <div className="dc-spark"><Spark pts={h.spark} color={total >= 0 ? 'var(--gain)' : 'var(--loss)'} w={260} h={48} /></div>
        <div className="dc-math">
          <div className="math-row"><span className="ui">Purchase</span><span className="mono">{d.buyUnits.toLocaleString()} @ {d.ccy === 'SGD' ? sgd(d.buyPx, d.buyPx < 100 ? 2 : 0) : '$' + L.NF(d.buyPx, 2)}</span></div>
          <div className="math-row sub"><span className="ui muted">{d.buyDate}{d.ccy !== 'SGD' ? ` · FX ${rate(d.buyFx)}` : ''}</span><span></span></div>
          <div className="math-row"><span className="ui">Current</span><span className="mono">{d.buyUnits.toLocaleString()} @ {d.ccy === 'SGD' ? sgd(d.curPx, d.curPx < 100 ? 2 : 0) : '$' + L.NF(d.curPx, 2)}</span></div>
          {d.ccy !== 'SGD' && <div className="math-row sub"><span className="ui muted">FX {rate(d.curFx)}</span><span></span></div>}
          <div className="dc-div" />
          <div className="math-row"><span className="ui" style={{ color: 'var(--gain)' }}>Asset gain</span><span className="mono" style={{ color: 'var(--gain)' }}>{d.ccy !== 'SGD' ? `+$${L.NF(assetGainNative)} × ${rate(d.curFx)} = ` : ''}{sgdSigned(h.assetGain)}</span></div>
          <div className="math-row"><span className="ui" style={{ color: h.fxGain >= 0 ? 'var(--fx-positive)' : 'var(--fx-negative)' }}>FX {h.fxGain >= 0 ? 'gain' : 'drag'}</span><span className="mono" style={{ color: h.fxGain >= 0 ? 'var(--fx-positive)' : 'var(--fx-negative)' }}>{h.fxGain === 0 ? '—' : sgdSigned(h.fxGain)}</span></div>
          <div className="math-row total"><span className="ui">Total gain</span><span className="mono">{sgdSigned(total)} <span style={{ color: total >= 0 ? 'var(--gain)' : 'var(--loss)' }}>({pct(h.totalPct)})</span></span></div>
        </div>
      </div>
    );
  }

  function Holdings() {
    const [q, setQ] = useState('');
    const [type, setType] = useState('All');
    const [sort, setSort] = useState({ k: 'totalPct', dir: -1 });
    const [picked, setPicked] = useState(['AAPLApple Inc.']); // pre-opened per spec (key = ticker+name)

    let rows = D.holdings.filter(h =>
      (type === 'All' || h.type === type) &&
      (q === '' || (h.name + h.ticker).toLowerCase().includes(q.toLowerCase()))
    );
    rows = [...rows].sort((a, b) => {
      const va = a[sort.k], vb = b[sort.k];
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
    const key = (h) => h.ticker + h.name;
    const toggle = (h) => setPicked(p => p.includes(key(h)) ? p.filter(x => x !== key(h)) : [...p, key(h)]);
    const sortBy = (k) => setSort(s => ({ k, dir: s.k === k ? -s.dir : -1 }));
    const cards = D.holdings.filter(h => picked.includes(key(h)));

    const Th = ({ k, children, right }) => (
      <th className={right ? 'r' : ''} onClick={k ? () => sortBy(k) : undefined} style={{ cursor: k ? 'pointer' : 'default' }}>
        {children}{k && <span className="sort-ar">{sort.k === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</span>}
      </th>
    );

    return (
      <div className="tab-body">
        {/* filter bar */}
        <div className="filterbar reveal">
          <div className="search">
            <Icon name="search" size={15} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search holdings…" />
            <kbd>/</kbd>
          </div>
          <div className="fpills">
            {TYPES.map(t => (
              <button key={t} className={'fpill' + (type === t ? ' active' : '')} onClick={() => setType(t)}>{t}</button>
            ))}
          </div>
          <button className="icon-btn ghost"><Icon name="download" size={15} /><span className="ui">CSV</span></button>
        </div>

        {/* table */}
        <div className="card no-pad reveal" style={{ animationDelay: '.05s' }}>
          <table className="htable">
            <thead>
              <tr>
                <Th k="name">Name / Ticker</Th>
                <Th>Type</Th>
                <Th>Broker</Th>
                <Th>Strategy</Th>
                <Th k="valueSGD" right>Value</Th>
                <Th k="assetGain" right>Asset Gain</Th>
                <Th k="fxGain" right>FX</Th>
                <Th k="totalPct" right>Total %</Th>
                <Th>CCY</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const sel = picked.includes(key(h));
                const total = h.assetGain + h.fxGain;
                return (
                  <tr key={key(h)} className={'hrow' + (sel ? ' sel' : '')} onClick={() => toggle(h)}>
                    <td>
                      <div className="cell-name">
                        <span className="row-ic"><Icon name={h.icon} size={15} /></span>
                        <span className="ui">{h.name}</span>
                        <span className="mono ticker">{h.ticker}</span>
                      </div>
                    </td>
                    <td><span className="ui dim">{h.type}</span></td>
                    <td><span className="ui dim">{h.broker}</span></td>
                    <td><span className={'strat ' + STRAT[h.strategy].cls}>{STRAT[h.strategy].label}</span></td>
                    <td className="r mono">{sgd(h.valueSGD)}</td>
                    <td className="r mono" style={{ color: 'var(--gain)' }}>{sgdSigned(h.assetGain)}</td>
                    <td className="r mono" style={{ color: h.fxGain > 0 ? 'var(--fx-positive)' : h.fxGain < 0 ? 'var(--fx-negative)' : 'var(--text-muted)' }}>{h.fxGain === 0 ? '—' : sgdSigned(h.fxGain)}</td>
                    <td className="r mono bold" style={{ color: total >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{pct(h.totalPct)}</td>
                    <td><span className="ccy-mini">{h.flag} <span className="mono dim">{h.ccy}</span></span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* compare tray */}
        <div className="compare reveal" style={{ animationDelay: '.1s' }}>
          <div className="compare-head">
            <span className="card-title">Inspector</span>
            <span className="ui muted">{cards.length ? `Comparing ${cards.length} holding${cards.length > 1 ? 's' : ''} · click rows to add or remove` : 'Click a holding to inspect — open several to compare side by side'}</span>
          </div>
          {cards.length > 0 ? (
            <div className="compare-tray">
              {cards.map(h => <DetailCard key={key(h)} h={h} onClose={() => toggle(h)} />)}
            </div>
          ) : (
            <div className="compare-empty ui muted">No holdings selected.</div>
          )}
        </div>
      </div>
    );
  }

  window.Panels = Object.assign(window.Panels || {}, { Holdings });
})();
