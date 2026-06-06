/* ===================================================================
   ADD / IMPORT TAB  +  EMPTY STATE
=================================================================== */
(function () {
  const { useState } = React;
  const L = window.PL, D = window.PD;
  const { Icon } = L;

  function Field({ label, children, full }) {
    return (
      <label className={'field' + (full ? ' full' : '')}>
        <span className="ui field-label">{label}</span>
        {children}
      </label>
    );
  }
  const Sel = ({ value }) => (
    <div className="select"><span className="ui">{value}</span><Icon name="chevron" size={14} /></div>
  );

  function AddImport() {
    const [drag, setDrag] = useState(false);
    const maps = [
      ['Stock Name', 'Name'],
      ['Buy Price', 'Purchase Price'],
      ['Qty', 'Units'],
      ['Date Bought', 'Purchase Date'],
      ['Currency', 'Currency'],
    ];
    return (
      <div className="tab-body">
        <div className="add-grid">
          {/* manual entry */}
          <div className="card reveal">
            <div className="card-head"><span className="card-title">Manual Entry</span><span className="ui muted">add a position</span></div>
            <div className="form">
              <Field label="Asset Name" full><input className="inp" placeholder="e.g. Microsoft Corp." /></Field>
              <Field label="Ticker"><input className="inp" placeholder="MSFT" /></Field>
              <Field label="Asset Type"><Sel value="Equity" /></Field>
              <Field label="Strategy"><Sel value="Long Term" /></Field>
              <Field label="Broker / Custodian"><input className="inp" placeholder="Tiger" /></Field>
              <Field label="Units"><input className="inp" placeholder="100" /></Field>
              <Field label="Currency"><Sel value="🇺🇸 USD" /></Field>
              <Field label="Purchase Price"><input className="inp" placeholder="412.50" /></Field>
              <Field label="Purchase Date"><input className="inp" placeholder="2023-04-15" /></Field>
              <Field label="Purchase FX Rate" full>
                <div className="fx-fetch">
                  <input className="inp" placeholder="1.3690" />
                  <button className="icon-btn ghost sm"><Icon name="refresh" size={14} /><span className="ui">Fetch rate</span></button>
                </div>
              </Field>
              <Field label="Notes" full><input className="inp" placeholder="optional" /></Field>
              <button className="btn-gold"><Icon name="plus" size={16} />Add Holding</button>
            </div>
          </div>

          {/* import & backup */}
          <div className="card reveal" style={{ animationDelay: '.06s' }}>
            <div className="card-head"><span className="card-title">Import &amp; Backup</span><span className="ui muted">CSV · XLSX · JSON</span></div>
            <div className={'dropzone' + (drag ? ' over' : '')}
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); }}>
              <Icon name="upload" size={26} style={{ color: 'var(--gold)' }} />
              <div className="dz-title ui">Drop CSV or XLSX here</div>
              <div className="ui muted">or click to browse</div>
              <div className="ui muted xs dz-sup">Supported: Tiger · Saxo · DBS Vickers · IBKR · Moomoo</div>
            </div>

            <div className="mapping">
              <div className="map-head ui muted">
                <span>Your Column</span><span>Maps To</span>
              </div>
              {maps.map(([from, to], i) => (
                <div className="map-row" key={i}>
                  <span className="mono map-from">"{from}"</span>
                  <Icon name="arrow" size={13} className="map-arrow" />
                  <Sel value={to} />
                </div>
              ))}
              <div className="map-ok ui"><Icon name="check" size={13} style={{ color: 'var(--gain)' }} /> 5 of 5 columns matched</div>
            </div>

            <div className="backup">
              <button className="icon-btn outline"><Icon name="download" size={15} />Export JSON</button>
              <button className="icon-btn outline"><Icon name="upload" size={15} />Import JSON</button>
            </div>
            <div className="ui muted xs privacy">Your data never leaves your browser.</div>
          </div>
        </div>
      </div>
    );
  }

  function EmptyState({ onAdd }) {
    const steps = [
      { n: '1', t: 'Add your holdings', s: 'Manually or import a broker file' },
      { n: '2', t: 'Prices fetched live', s: 'Quotes & FX rates auto-updated' },
      { n: '3', t: 'Insight unlocked', s: 'See true gains, FX & allocation' },
    ];
    return (
      <div className="empty">
        <div className="empty-mark serif">◈ PORTFOLIO</div>
        <div className="empty-title serif">Your wealth dashboard awaits</div>
        <div className="empty-sub ui muted">Three steps to a complete picture of your global portfolio.</div>
        <div className="steps">
          {steps.map((s, i) => (
            <React.Fragment key={i}>
              <div className="step reveal" style={{ animationDelay: (0.1 + i * 0.08) + 's' }}>
                <div className="step-badge mono">{s.n}</div>
                <div className="step-t ui">{s.t}</div>
                <div className="step-s ui muted">{s.s}</div>
              </div>
              {i < 2 && <div className="step-arrow"><L.Icon name="arrow" size={18} /></div>}
            </React.Fragment>
          ))}
        </div>
        <button className="btn-gold lg" onClick={onAdd}><L.Icon name="plus" size={17} />Add Your First Holding</button>
      </div>
    );
  }

  window.Panels = Object.assign(window.Panels || {}, { AddImport, EmptyState });
})();
