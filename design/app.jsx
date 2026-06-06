/* ===================================================================
   APP SHELL — split canvas: nerve bar + tabs + sticky summary + content
=================================================================== */
(function () {
  const { useState, useEffect } = React;
  const L = window.PL,D = window.PD;
  const { Icon, Donut, Legend, useCountUp, sgd, sgdSigned, pct } = L;
  const P = window.Panels;
  const { useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakColor } = window;

  const TABS = ['Overview', 'Holdings', 'FX Lab', 'Charts', 'Analysis', 'Add / Import'];

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "#b79cff",
    "lightMode": false,
    "grain": true,
    "motion": true
  }/*EDITMODE-END*/;

  const DARK_ACCENTS = ['#b79cff', '#7c9cff', '#5fd0c6', '#e58ad0'];
  const LIGHT_ACCENTS = ['#6b4bd6', '#2563c9', '#0f8f80', '#b8458f'];

  const hexA = (hex, a) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  /* ---- sticky wealth summary rail ---- */
  function SummaryRail() {
    const ac = D.assetClass;
    const top = ac[0];
    return (
      <aside className="summary">
        <div className="sm-block">
          <div className="ui muted xs">Allocation</div>
          <div className="sm-donut">
            <Donut data={ac} size={132} thickness={18}>
              <div>
                <div className="ui muted xs">{top.label}</div>
                <div className="mono donut-pct sm">{top.value}%</div>
              </div>
            </Donut>
          </div>
          <Legend data={ac} />
        </div>

        <div className="sm-div" />

        <div className="sm-metrics">
          <div className="sm-metric">
            <span className="ui muted xs">Total Gain</span>
            <span className="mono sm-v" style={{ color: 'var(--gain)' }}>{sgdSigned(D.hero.totalGain)}</span>
            <span className="mono sm-sub" style={{ color: 'var(--gain)' }}>{pct(D.hero.totalGainPct)}</span>
          </div>
          <div className="sm-metric">
            <span className="ui muted xs">FX Impact</span>
            <span className="mono sm-v" style={{ color: 'var(--fx-positive)' }}>{sgdSigned(D.hero.fxImpact)}</span>
            <span className="mono sm-sub" style={{ color: 'var(--fx-positive)' }}>{pct(D.hero.fxPct)}</span>
          </div>
          <div className="sm-metric">
            <span className="ui muted xs">Today</span>
            <span className="mono sm-v" style={{ color: 'var(--gain)' }}>{sgdSigned(D.hero.dayChange)}</span>
            <span className="mono sm-sub" style={{ color: 'var(--gain)' }}>{pct(D.hero.dayPct)}</span>
          </div>
        </div>

        <div className="sm-div" />
        <div className="sm-foot">
          <span className="ui muted xs">Updated {D.hero.updated}</span>
          <span className="sm-live"><i />live</span>
        </div>
      </aside>);

  }

  /* ---- nerve bar ---- */
  function NerveBar({ animate }) {
    const total = useCountUp(D.hero.total, 1300, animate);
    const [spin, setSpin] = useState(false);
    return (
      <header className="nerve">
        <div className="wordmark">
          <span className="serif mark">PORTFOLIO</span>
          <span className="ui mark-sub">PERSONAL WEALTH TERMINAL</span>
        </div>
        <div className="nerve-center">
          <div className="mono hero-total">{sgd(total, 2)}</div>
          <div className="hero-day">
            <Icon name="up" size={13} style={{ color: 'var(--gain)' }} />
            <span className="mono" style={{ color: 'var(--gain)' }}>{sgdSigned(D.hero.dayChange)} ({pct(D.hero.dayPct)})</span>
          </div>
        </div>
        <div className="nerve-right">
          <div className="nr-fx mono">FX <span style={{ color: 'var(--fx-positive)' }}>{sgdSigned(D.hero.fxImpact)}</span></div>
          <div className="nr-time mono">{D.hero.updated}</div>
          <button className={'refresh' + (spin ? ' spin' : '')} onClick={() => {setSpin(true);setTimeout(() => setSpin(false), 800);}}>
            <Icon name="refresh" size={16} />
          </button>
        </div>
      </header>);

  }

  /* ---- skeleton ---- */
  function Skeleton() {
    return (
      <div className="tab-body">
        <div className="ov-grid">
          <div className="card"><div className="sk" style={{ height: 18, width: 120, marginBottom: 18 }} /><div className="sk" style={{ height: 150, width: 150, borderRadius: '50%', margin: '0 auto' }} /></div>
          <div className="card"><div className="sk" style={{ height: 18, width: 140, marginBottom: 18 }} /><div className="sk" style={{ height: 14, marginBottom: 10 }} /><div className="sk" style={{ height: 60 }} /></div>
        </div>
        <div className="movers-grid">
          {[0, 1].map((i) => <div className="card" key={i}><div className="sk" style={{ height: 16, width: 100, marginBottom: 16 }} />{[0, 1, 2, 3].map((j) => <div className="sk" key={j} style={{ height: 22, marginBottom: 10 }} />)}</div>)}
        </div>
      </div>);

  }

  function App() {
    const [tab, setTab] = useState(0);
    const [loading, setLoading] = useState(true);
    const [empty, setEmpty] = useState(false);
    const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);

    useEffect(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const t = setTimeout(() => setLoading(false), reduce ? 0 : 620);
      return () => clearTimeout(t);
    }, []);

    // tweaks bridge (optional)
    useEffect(() => {
      window.__setEmpty = setEmpty;
    }, []);

    // apply appearance tweaks
    useEffect(() => {
      const root = document.documentElement;
      root.style.setProperty('--gold', tw.accent);
      root.style.setProperty('--border-gold', hexA(tw.accent, 0.34));
      root.style.setProperty('--gold-dim', hexA(tw.accent, 0.62));
      root.style.setProperty('--accent-wash', hexA(tw.accent, 0.10));
      root.style.setProperty('--accent-tint', hexA(tw.accent, 0.16));
      root.style.setProperty('--accent-glow', hexA(tw.accent, 0.28));
    }, [tw.accent]);
    useEffect(() => { document.body.classList.toggle('no-grain', !tw.grain); }, [tw.grain]);
    useEffect(() => { document.body.classList.toggle('no-motion', !tw.motion); }, [tw.motion]);

    // light mode — toggle html class and swap accent to theme-appropriate default
    useEffect(() => {
      document.documentElement.classList.toggle('light', tw.lightMode);
      if (tw.lightMode && tw.accent === '#b79cff') setTweak('accent', '#6b4bd6');
      if (!tw.lightMode && tw.accent === '#6b4bd6') setTweak('accent', '#b79cff');
    }, [tw.lightMode]);

    // Overview (tab 0) folds the summary into its own pane, so the rail is hidden there.
    const showSidebar = !empty && tab !== 0;

    const content = () => {
      if (loading) return <Skeleton />;
      if (empty) return <P.EmptyState onAdd={() => {setEmpty(false);setTab(5);}} />;
      switch (tab) {
        case 0:return <P.Overview />;
        case 1:return <P.Holdings />;
        case 2:return <P.FXLab />;
        case 3:return <P.Charts />;
        case 4:return <P.Analysis />;
        case 5:return <P.AddImport />;
        default:return null;
      }
    };

    return (
      <div className="app">
        <NerveBar animate={!loading && tw.motion} />
        <nav className="tabbar">
          {TABS.map((t, i) =>
          <button key={t} className={'tab' + (i === tab && !empty ? ' active' : '')}
          onClick={() => {setEmpty(false);setTab(i);}}>{t}</button>
          )}
          <div className="tab-spacer" />
          <button className={'tab demo' + (empty ? ' active' : '')} onClick={() => setEmpty((e) => !e)}>
            {empty ? 'Dashboard' : 'Empty state'}
          </button>
        </nav>
        <div className="body">
          {showSidebar && <SummaryRail />}
          <main className={'content' + (empty ? ' full' : '') + (showSidebar ? '' : ' nosb')} key={empty ? 'empty' : tab}>
            {content()}
          </main>
        </div>

        <TweaksPanel>
          <TweakSection label="Appearance" />
          <TweakToggle label="Light mode" value={tw.lightMode} onChange={(v) => setTweak('lightMode', v)} />
          <TweakColor label="Accent" value={tw.accent} options={tw.lightMode ? LIGHT_ACCENTS : DARK_ACCENTS} onChange={(v) => setTweak('accent', v)} />
          <TweakToggle label="Film grain" value={tw.grain} onChange={(v) => setTweak('grain', v)} />
          <TweakToggle label="Motion" value={tw.motion} onChange={(v) => setTweak('motion', v)} />
        </TweaksPanel>
      </div>);

  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();