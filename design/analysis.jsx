/* ===================================================================
   ANALYSIS TAB — AI market-sentiment read on the portfolio
   Calls window.claude.complete; falls back to a curated sample.
=================================================================== */
(function () {
  const { useState, useEffect, useRef } = React;
  const L = window.PL, D = window.PD;
  const { Icon } = L;

  // assets to analyse (stable id per holding)
  const ASSETS = D.holdings.map((h, i) => ({
    id: h.ticker !== '—' ? h.ticker : (h.type + '_' + i),
    name: h.name, type: h.type, icon: h.icon,
  }));

  const labelFor = (s) => (s >= 25 ? 'Bullish' : s <= -25 ? 'Bearish' : 'Neutral');
  const cls = (s) => (s >= 25 ? 'bull' : s <= -25 ? 'bear' : 'neut');
  const tone = (s) => (s >= 25 ? 'var(--gain)' : s <= -25 ? 'var(--loss)' : 'var(--gold)');
  const clamp = (n) => Math.max(-100, Math.min(100, Math.round(Number(n) || 0)));
  const mean = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);

  // curated fallback — keeps the page beautiful if the AI is unreachable
  const FALLBACK = {
    overall: { score: 43, note: 'Constructive book; rates and FX are the swing factors.' },
    items: {
      AAPL: { score: 62, summary: 'Resilient iPhone demand and double-digit services growth; the AI roadmap and steady buybacks support the multiple.', drivers: ['Services margin', 'AI roadmap', 'Buybacks'] },
      CICT: { score: 16, summary: 'Singapore retail and office occupancy stays firm; rate cuts would help, but new office supply caps the upside.', drivers: ['Rate cuts', 'High occupancy', 'Office supply'] },
      IWDA: { score: 47, summary: 'Broad developed-market exposure rides the global rally, though heavy US mega-cap weighting concentrates the risk.', drivers: ['Global rally', 'US mega-caps', 'Low cost'] },
      Gold_3: { score: 55, summary: 'Central-bank buying and rate-cut expectations underpin bullion; safe-haven demand remains firm into year-end.', drivers: ['Central banks', 'Rate cuts', 'Haven demand'] },
      RE_4: { score: 28, summary: 'Singapore EC values hold on tight supply; cooling measures and elevated rates temper near-term gains.', drivers: ['Tight supply', 'Cooling rules', 'Mortgage rates'] },
    },
  };

  // curated fallback headlines per holding
  const FALLBACK_HL = {
    AAPL: [
      { t: 'Services revenue hits record as App Store momentum builds', src: 'Bloomberg', sent: 'pos', ago: '3h' },
      { t: 'Analysts trim iPhone unit estimates on China softness', src: 'Reuters', sent: 'neg', ago: '1d' },
      { t: 'New on-device AI features roll out across the lineup', src: 'The Verge', sent: 'pos', ago: '2d' },
    ],
    CICT: [
      { t: 'Singapore retail rents edge higher on tourism recovery', src: 'Biz Times', sent: 'pos', ago: '5h' },
      { t: 'Office leasing slows as supply pipeline expands', src: 'EdgeProp', sent: 'neg', ago: '2d' },
      { t: 'REIT reaffirms full-year distribution guidance', src: 'SGX', sent: 'neu', ago: '4d' },
    ],
    IWDA: [
      { t: 'Developed-market equities extend rally to fresh highs', src: 'FT', sent: 'pos', ago: '2h' },
      { t: 'Concentration in US mega-caps raises diversification flags', src: 'Morningstar', sent: 'neg', ago: '1d' },
      { t: 'Passive inflows accelerate into global index funds', src: 'ETF.com', sent: 'pos', ago: '3d' },
    ],
    Gold_3: [
      { t: 'Central banks add to gold reserves for ninth month', src: 'WGC', sent: 'pos', ago: '6h' },
      { t: 'Bullion dips as dollar firms on rate repricing', src: 'Kitco', sent: 'neg', ago: '1d' },
      { t: 'Haven demand steady amid geopolitical tension', src: 'Reuters', sent: 'neu', ago: '2d' },
    ],
    RE_4: [
      { t: 'EC resale prices firm on limited launch supply', src: 'PropGuru', sent: 'pos', ago: '8h' },
      { t: 'Cooling measures keep buyer sentiment in check', src: 'Straits Times', sent: 'neg', ago: '2d' },
      { t: 'Mortgage rates hold after central bank stands pat', src: 'CNA', sent: 'neu', ago: '5d' },
    ],
  };
  const genericHL = (it) => ([
    { t: `Sentiment steady for ${it.name} into the week`, src: 'Wire', sent: 'neu', ago: '1d' },
    { t: `Sector flows turn supportive for ${it.type.toLowerCase()}`, src: 'Markets', sent: 'pos', ago: '2d' },
    { t: 'Macro backdrop adds near-term uncertainty', src: 'Macro', sent: 'neg', ago: '3d' },
  ]);
  const HL_CACHE = {};

  async function fetchHeadlines(it) {
    if (!window.claude || !window.claude.complete) return FALLBACK_HL[it.id] || genericHL(it);
    try {
      const prompt =
        'For a wealth-terminal design demo, invent 3 realistic-but-illustrative recent news headlines that would move market sentiment for ' +
        it.name + ' (' + it.type + '). Do NOT present these as real news.\n' +
        'Return ONLY minified JSON: {"headlines":[{"t":"<=11 words","src":"<=2 word source","sent":"pos|neg|neu","ago":"like 2h or 1d"}]}';
      const txt = await window.claude.complete(prompt);
      const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
      const j = JSON.parse(txt.slice(a, b + 1));
      const hs = (j.headlines || []).slice(0, 3).map((h) => ({
        t: String(h.t || '').trim(), src: String(h.src || 'Wire').trim(),
        sent: ['pos', 'neg', 'neu'].includes(h.sent) ? h.sent : 'neu', ago: String(h.ago || '1d').trim(),
      })).filter((h) => h.t);
      return hs.length ? hs : (FALLBACK_HL[it.id] || genericHL(it));
    } catch (e) { return FALLBACK_HL[it.id] || genericHL(it); }
  }

  // deterministic 12-pt sentiment path that lands on the current score
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function sentPath(id, score) {
    let seed = hashStr(id); const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const n = 12, start = score - 24 + rnd() * 16, pts = [];
    for (let i = 0; i < n; i++) { const t = i / (n - 1); const base = start * (1 - t) + score * t; pts.push(Math.max(-100, Math.min(100, Math.round(base + (rnd() - 0.5) * 20)))); }
    pts[n - 1] = score; return pts;
  }

  function MiniSpark({ pts, color, height = 44 }) {
    const ref = useRef(null);
    const [w, setW] = useState(260);
    const idRef = useRef('ms' + Math.round(Math.random() * 1e9));
    useEffect(() => {
      const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
      if (ref.current) ro.observe(ref.current);
      return () => ro.disconnect();
    }, []);
    const min = Math.min(...pts), max = Math.max(...pts), rng = (max - min) || 1;
    const step = w / (pts.length - 1);
    const Y = (v) => height - 4 - ((v - min) / rng) * (height - 8);
    const line = pts.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${w},${height} L0,${height} Z`;
    const id = idRef.current;
    return (
      <div ref={ref} style={{ width: '100%' }}>
        <svg width={w} height={height} style={{ display: 'block', overflow: 'visible' }}>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" /><stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient></defs>
          <path d={area} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={w} cy={Y(pts[pts.length - 1])} r="2.4" fill={color} />
        </svg>
      </div>
    );
  }

  function SentDrawer({ it }) {
    const [hl, setHl] = useState(HL_CACHE[it.id] || null);
    const [loading, setLoading] = useState(!HL_CACHE[it.id]);
    useEffect(() => {
      if (HL_CACHE[it.id]) return;
      let live = true;
      (async () => { const h = await fetchHeadlines(it); HL_CACHE[it.id] = h; if (live) { setHl(h); setLoading(false); } })();
      return () => { live = false; };
    }, []);
    const pts = sentPath(it.id, it.score);
    const delta = pts[pts.length - 1] - pts[0];
    return (
      <div className="sent-drawer">
        <div className="sd-trend">
          <div className="sd-trend-head">
            <span className="ui muted xs">30-day sentiment</span>
            <span className="mono xs" style={{ color: delta >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} pts</span>
          </div>
          <MiniSpark pts={pts} color={tone(it.score)} />
        </div>
        <div className="sd-news">
          {loading
            ? [0, 1, 2].map((i) => (
              <div className="hl-row" key={i}><div className="sk" style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 5 }} /><div className="hl-body" style={{ flex: 1, gap: 6 }}><div className="sk" style={{ height: 11, width: '88%' }} /><div className="sk" style={{ height: 9, width: 70 }} /></div></div>
            ))
            : hl.map((h, i) => (
              <div className="hl-row" key={i}>
                <i className={'hl-dot ' + h.sent} />
                <div className="hl-body"><div className="hl-t">{h.t}</div><div className="hl-meta">{h.src} · {h.ago}</div></div>
              </div>
            ))}
        </div>
      </div>
    );
  }

  let SENT_CACHE = null; // persists across tab switches

  function buildFromFallback() {
    const items = ASSETS.map((a) => ({ ...a, ...(FALLBACK.items[a.id] || { score: 0, summary: '', drivers: [] }) }));
    return { items, overall: { score: FALLBACK.overall.score, note: FALLBACK.overall.note }, source: 'sample' };
  }

  async function runAI() {
    if (!window.claude || !window.claude.complete) return buildFromFallback();
    const prompt =
      'You are an equity & macro sentiment analyst inside a personal wealth terminal. Assess current market sentiment for each holding below. This is a design demo — reason from your general knowledge of each company / asset class; do NOT claim live data and do NOT give financial advice.\n\n' +
      'Respond with ONLY minified JSON (no markdown, no commentary) in exactly this shape:\n' +
      '{"overall":{"score":INT,"note":"<=13 words"},"items":[{"id":"ID","score":INT,"summary":"<=24 words","drivers":["<=3 words","<=3 words","<=3 words"]}]}\n' +
      'score is an integer from -100 (very bearish) to 100 (very bullish). Echo back each id exactly.\n\n' +
      'Holdings:\n' + ASSETS.map((a) => `- id=${a.id} | ${a.name} | ${a.type}`).join('\n');
    const txt = await window.claude.complete(prompt);
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    const json = JSON.parse(txt.slice(a, b + 1));
    const byId = {};
    (json.items || []).forEach((x) => { byId[String(x.id)] = x; });
    const items = ASSETS.map((as) => {
      const f = byId[String(as.id)] || FALLBACK.items[as.id] || {};
      return { ...as, score: clamp(f.score), summary: f.summary || '', drivers: (f.drivers || []).slice(0, 3) };
    });
    const ovScore = json.overall && json.overall.score != null ? clamp(json.overall.score) : mean(items.map((i) => i.score));
    const note = (json.overall && json.overall.note) || FALLBACK.overall.note;
    return { items, overall: { score: ovScore, note }, source: 'ai' };
  }

  /* ---- score rail ---- */
  function ScoreRail({ score }) {
    const w = (Math.abs(score) / 100) * 50;
    const left = score >= 0 ? 50 : 50 - w;
    return (
      <div className="score-wrap">
        <div className="score-rail">
          <div className="score-zero" />
          <div className="score-fill" style={{ left: left + '%', width: w + '%', background: tone(score) }} />
        </div>
        <span className="score-num" style={{ color: tone(score) }}>{score > 0 ? '+' : ''}{score}</span>
      </div>
    );
  }

  function SentCard({ it, delay }) {
    const [open, setOpen] = useState(false);
    return (
      <div className={'card sent-card reveal' + (open ? ' open' : '')} style={{ animationDelay: delay + 's' }}>
        <div className="sent-top">
          <div className="row-ic"><Icon name={it.icon} size={15} /></div>
          <div className="sent-id">
            <span className="ui">{it.name}</span>
            <span className="mono ticker">{it.id.replace(/_\d+$/, '')}</span>
          </div>
          <span className={'sent-pill ' + cls(it.score)}>{labelFor(it.score)}</span>
        </div>
        <ScoreRail score={it.score} />
        <div className="sent-sum">{it.summary}</div>
        {it.drivers.length > 0 && (
          <div className="drivers">
            {it.drivers.map((d, i) => <span className="driver" key={i}>{d}</span>)}
          </div>
        )}
        <button className="sent-more" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide detail' : 'Headlines & 30-day trend'}<Icon name="chevron" size={14} />
        </button>
        {open && <SentDrawer it={it} />}
      </div>
    );
  }

  function SkelCard({ delay }) {
    return (
      <div className="card sent-card reveal" style={{ animationDelay: delay + 's' }}>
        <div className="sent-top">
          <div className="sk" style={{ width: 28, height: 28, borderRadius: 7 }} />
          <div className="sent-id" style={{ gap: 6 }}>
            <div className="sk" style={{ width: 130, height: 12 }} />
            <div className="sk" style={{ width: 50, height: 9 }} />
          </div>
          <div className="sk" style={{ width: 66, height: 22, borderRadius: 999 }} />
        </div>
        <div className="sk" style={{ height: 10, borderRadius: 6 }} />
        <div className="sk" style={{ height: 34 }} />
        <div className="drivers">
          {[44, 60, 50].map((w, i) => <div className="sk" key={i} style={{ width: w, height: 22, borderRadius: 7 }} />)}
        </div>
      </div>
    );
  }

  /* ---- aggregate hero ---- */
  function Hero({ overall, items }) {
    const counts = { bull: 0, neut: 0, bear: 0 };
    items.forEach((i) => { counts[cls(i.score)]++; });
    const mark = ((overall.score + 100) / 200) * 100;
    return (
      <div className="card an-hero reveal">
        <div className="anh-left">
          <span className="ui muted xs">Portfolio sentiment</span>
          <span className="anh-label" style={{ color: tone(overall.score) }}>{labelFor(overall.score)}</span>
          <span className="anh-score" style={{ color: tone(overall.score) }}>{overall.score > 0 ? '+' : ''}{overall.score} <span className="muted">/ 100</span></span>
          <span className="anh-note">{overall.note}</span>
        </div>
        <div className="anh-right">
          <div className="meter"><div className="meter-mark" style={{ left: `calc(${mark}% - 2px)` }} /></div>
          <div className="meter-scale"><span>Bearish</span><span>Neutral</span><span>Bullish</span></div>
          <div className="dist">
            <span className="dist-item"><i className="dist-dot" style={{ background: 'var(--gain)' }} /><b>{counts.bull}</b> Bullish</span>
            <span className="dist-item"><i className="dist-dot" style={{ background: 'var(--gold)' }} /><b>{counts.neut}</b> Neutral</span>
            <span className="dist-item"><i className="dist-dot" style={{ background: 'var(--loss)' }} /><b>{counts.bear}</b> Bearish</span>
          </div>
        </div>
      </div>
    );
  }

  /* ---- ask box ---- */
  const SUGGEST = ['What is my biggest risk?', 'Summarise my book in two lines', 'Which holding looks most fragile?'];

  function AskBox() {
    const [q, setQ] = useState('');
    const [ans, setAns] = useState('');
    const [phase, setPhase] = useState('idle'); // idle | thinking | typing | done
    const timer = useRef(null);

    useEffect(() => () => clearInterval(timer.current), []);

    const typewrite = (full) => {
      clearInterval(timer.current);
      let i = 0; setAns(''); setPhase('typing');
      timer.current = setInterval(() => {
        i += 2; setAns(full.slice(0, i));
        if (i >= full.length) { clearInterval(timer.current); setPhase('done'); }
      }, 14);
    };

    const ask = async (text) => {
      const query = (text != null ? text : q).trim();
      if (!query || phase === 'thinking') return;
      if (text != null) setQ(text);
      setPhase('thinking'); setAns('');
      try {
        if (!window.claude || !window.claude.complete) throw new Error('offline');
        const ctx = D.holdings.map((h) => `${h.name} (${h.type}, ${h.totalPct >= 0 ? '+' : ''}${h.totalPct}%)`).join('; ');
        const p =
          'You are a concise portfolio analyst inside a personal wealth terminal. ' +
          'Portfolio: total S$1.28M, +16.7% life-to-date, currency contributed +1.0%. Holdings: ' + ctx + '. ' +
          'This is a design demo — no financial advice or disclaimers.\n\nUser question: "' + query + '"\n\n' +
          'Answer in 2–3 short, specific sentences. Plain text only, no markdown.';
        const r = await window.claude.complete(p);
        typewrite(String(r).trim());
      } catch (e) {
        typewrite('The analysis engine is offline in this preview. Once connected, this answers questions about your book in plain language.');
      }
    };

    return (
      <div className="card ask">
        <div className="card-head"><span className="card-title">Ask the analyst</span><span className="ui muted">AI · plain language</span></div>
        <div className="ask-row">
          <input className="inp" placeholder="Ask anything about your portfolio…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} />
          <button className="btn-gold" style={{ margin: 0, padding: '11px 20px', gridColumn: 'auto' }}
            disabled={phase === 'thinking'} onClick={() => ask()}>
            {phase === 'thinking' ? 'Thinking…' : 'Ask'}
          </button>
        </div>
        <div className="ask-chips">
          {SUGGEST.map((s) => <button className="ask-chip" key={s} onClick={() => ask(s)}>{s}</button>)}
        </div>
        {phase === 'thinking' && <div className="ask-answer muted">Reading your book<span className="cursor" /></div>}
        {(phase === 'typing' || phase === 'done') &&
          <div className="ask-answer">{ans}{phase === 'typing' && <span className="cursor" />}</div>}
      </div>
    );
  }

  function Analysis() {
    const [data, setData] = useState(SENT_CACHE);
    const [loading, setLoading] = useState(!SENT_CACHE);

    const run = async () => {
      setLoading(true);
      let res;
      try { res = await runAI(); } catch (e) { res = buildFromFallback(); }
      SENT_CACHE = res; setData(res); setLoading(false);
    };

    useEffect(() => { if (!SENT_CACHE) run(); }, []);

    return (
      <div className="tab-body">
        <div className="an-head reveal">
          <div>
            <div className="an-eyebrow">AI Analysis</div>
            <h2>Market sentiment</h2>
            <div className="an-sub">A live read on every holding — direction, conviction, and the drivers moving each position.</div>
          </div>
          <div className="an-actions">
            <span className="an-ai-chip"><i />{loading ? 'Analysing…' : data && data.source === 'ai' ? 'Updated just now' : 'Sample data'}</span>
            <button className="btn-gold" style={{ margin: 0, padding: '11px 18px', gridColumn: 'auto' }}
              disabled={loading} onClick={run}>
              <Icon name="refresh" size={15} />{loading ? 'Running' : 'Re-run'}
            </button>
          </div>
        </div>

        {loading ? (
          <>
            <div className="card an-hero"><div className="anh-left"><div className="sk" style={{ width: 120, height: 12, marginBottom: 8 }} /><div className="sk" style={{ width: 160, height: 38, marginBottom: 8 }} /><div className="sk" style={{ width: 200, height: 12 }} /></div><div className="anh-right"><div className="sk" style={{ height: 12, borderRadius: 8 }} /><div className="sk" style={{ height: 36, marginTop: 6 }} /></div></div>
            <div className="sent-grid">
              <div className="sent-col">{ASSETS.filter((_, i) => i % 2 === 0).map((a, i) => <SkelCard key={a.id} delay={i * 0.05} />)}</div>
              <div className="sent-col">{ASSETS.filter((_, i) => i % 2 === 1).map((a, i) => <SkelCard key={a.id} delay={i * 0.05 + 0.04} />)}</div>
            </div>
          </>
        ) : data && (
          <>
            <Hero overall={data.overall} items={data.items} />
            <AskBox />
            <div className="sent-grid">
              <div className="sent-col">
                {data.items.filter((_, i) => i % 2 === 0).map((it, i) => <SentCard key={it.id} it={it} delay={0.05 + i * 0.08} />)}
              </div>
              <div className="sent-col">
                {data.items.filter((_, i) => i % 2 === 1).map((it, i) => <SentCard key={it.id} it={it} delay={0.09 + i * 0.08} />)}
              </div>
            </div>
            {data.source === 'sample' && (
              <div className="an-note"><Icon name="file" size={13} />Showing a curated sample — connect the analysis engine for a live read.</div>
            )}
          </>
        )}
      </div>
    );
  }

  window.Panels = Object.assign(window.Panels || {}, { Analysis });
})();
