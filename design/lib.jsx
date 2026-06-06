/* ===================================================================
   PORTFOLIO TERMINAL — shared lib: formatters, icons, charts
   Exposed as window.PL
=================================================================== */
(function () {
  const { useState, useEffect, useRef, useMemo } = React;

  /* ---------------- formatters ---------------- */
  const NF = (n, d = 0) => Math.abs(n).toLocaleString('en-SG', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgd = (n, d = 0) => 'S$' + NF(n, d);
  const sgdSigned = (n, d = 0) => (n < 0 ? '−' : '+') + 'S$' + NF(n, d);
  const pct = (n, d = 2) => (n < 0 ? '−' : '+') + NF(n, d) + '%';
  const rate = (n) => NF(n, 4);

  /* ---------------- count-up hook ---------------- */
  function useCountUp(target, dur = 1200, run = true) {
    const [v, setV] = useState(run ? 0 : target);
    useEffect(() => {
      if (!run) { setV(target); return; }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return; }
      let raf, start;
      const tick = (t) => {
        if (!start) start = t;
        const p = Math.min(1, (t - start) / dur);
        setV(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [target, run]);
    return v;
  }

  /* ---------------- icons (inline, lucide-style) ---------------- */
  const PATHS = {
    search: ['<circle cx="11" cy="11" r="8"/>', '<path d="m21 21-4.3-4.3"/>'],
    refresh: ['<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>', '<path d="M21 3v5h-5"/>', '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>', '<path d="M8 16H3v5"/>'],
    download: ['<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>', '<path d="m7 10 5 5 5-5"/>', '<path d="M12 15V3"/>'],
    upload: ['<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>', '<path d="m17 8-5-5-5 5"/>', '<path d="M12 3v12"/>'],
    plus: ['<path d="M5 12h14"/>', '<path d="M12 5v14"/>'],
    chevron: ['<path d="m6 9 6 6 6-6"/>'],
    up: ['<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/>', '<path d="M16 7h6v6"/>'],
    down: ['<path d="m22 17-8.5-8.5-5 5L2 7"/>', '<path d="M16 17h6v-6"/>'],
    x: ['<path d="M18 6 6 18"/>', '<path d="m6 6 12 12"/>'],
    arrow: ['<path d="M5 12h14"/>', '<path d="m12 5 7 7-7 7"/>'],
    briefcase: ['<rect width="20" height="14" x="2" y="7" rx="2"/>', '<path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'],
    landmark: ['<path d="M3 22h18"/>', '<path d="M6 18v-7"/>', '<path d="M10 18v-7"/>', '<path d="M14 18v-7"/>', '<path d="M18 18v-7"/>', '<path d="M4 11h16"/>', '<path d="m12 2 8 6H4z"/>'],
    layers: ['<path d="m12.83 2.18 6.36 3.18a1 1 0 0 1 0 1.79L12.83 10.3a2 2 0 0 1-1.66 0L4.81 7.15a1 1 0 0 1 0-1.79l6.36-3.18a2 2 0 0 1 1.66 0Z"/>', '<path d="m5 12 6.17 3.09a2 2 0 0 0 1.66 0L19 12"/>', '<path d="m5 17 6.17 3.09a2 2 0 0 0 1.66 0L19 17"/>'],
    gem: ['<path d="M6 3h12l4 6-10 13L2 9Z"/>', '<path d="M11 3 8 9l4 13 4-13-3-6"/>', '<path d="M2 9h20"/>'],
    building: ['<rect width="16" height="20" x="4" y="2" rx="2"/>', '<path d="M9 22v-4h6v4"/>', '<path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>'],
    file: ['<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>', '<path d="M14 2v4a2 2 0 0 0 2 2h4"/>'],
    sliders: ['<line x1="4" x2="4" y1="21" y2="14"/>', '<line x1="4" x2="4" y1="10" y2="3"/>', '<line x1="12" x2="12" y1="21" y2="12"/>', '<line x1="12" x2="12" y1="8" y2="3"/>', '<line x1="20" x2="20" y1="21" y2="16"/>', '<line x1="20" x2="20" y1="12" y2="3"/>', '<line x1="2" x2="6" y1="14" y2="14"/>', '<line x1="10" x2="14" y1="8" y2="8"/>', '<line x1="18" x2="22" y1="16" y2="16"/>'],
    check: ['<path d="M20 6 9 17l-5-5"/>'],
  };
  function Icon({ name, size = 18, style, className, strokeWidth = 1.75 }) {
    const ps = PATHS[name] || [];
    return React.createElement('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
      className, style, dangerouslySetInnerHTML: { __html: ps.join('') },
    });
  }

  /* ---------------- Donut ---------------- */
  function Donut({ data, size = 130, thickness = 20, gap = 2.5, highlight = -1, onSlice, children }) {
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    const total = data.reduce((s, d) => s + d.value, 0);
    let acc = 0;
    return (
      <div style={{ position: 'relative', width: `min(${size}px, 100%)`, aspectRatio: '1' }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={thickness} />
          {data.map((d, i) => {
            const frac = d.value / total;
            const len = Math.max(c * frac - gap, 0.001);
            const off = -acc * c;
            acc += frac;
            const dim = highlight >= 0 && highlight !== i;
            return (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={d.color} strokeWidth={highlight === i ? thickness + 3 : thickness}
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={off} strokeLinecap="butt"
                onClick={onSlice ? () => onSlice(i) : undefined}
                style={{ opacity: dim ? 0.28 : 1, cursor: onSlice ? 'pointer' : 'default', transition: 'opacity .25s, stroke-width .2s' }} />
            );
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
      </div>
    );
  }

  function Legend({ data, highlight = -1, onItem, showPct = true }) {
    return (
      <div className="legend">
        {data.map((d, i) => (
          <button key={i} className="legend-item" onClick={onItem ? () => onItem(i) : undefined}
            style={{ opacity: highlight >= 0 && highlight !== i ? 0.4 : 1, cursor: onItem ? 'pointer' : 'default' }}>
            <i style={{ background: d.color }} />
            <span className="ui">{d.label}</span>
            {showPct && <span className="mono lg-pct">{d.value}%</span>}
          </button>
        ))}
      </div>
    );
  }

  /* ---------------- Dumbbell (asset + fx, from zero) ---------------- */
  function Dumbbell({ asset, fx, scale }) {
    // scale = max abs total across set; render on a centered axis (neg left / pos right)
    const total = asset + fx;
    const W = 100; // percent space; zero at 50%
    const px = (v) => (v / scale) * 50; // half-width = scale
    const assetEnd = px(asset);
    const totalEnd = px(total);
    const fxColor = fx >= 0 ? 'var(--fx-positive)' : 'var(--fx-negative)';
    const assetColor = asset >= 0 ? 'var(--gain)' : 'var(--loss)';
    const aLeft = asset >= 0 ? 50 : 50 + assetEnd;
    const aWidth = Math.abs(assetEnd);
    // fx segment goes from assetEnd to totalEnd
    const fxFrom = 50 + Math.min(assetEnd, totalEnd);
    const fxWidth = Math.abs(totalEnd - assetEnd);
    return (
      <div className="dumbbell">
        <div className="db-axis" />
        <div className="db-zero" />
        <div className="db-seg" style={{ left: aLeft + '%', width: aWidth + '%', background: assetColor }} />
        <div className="db-fx" style={{ left: fxFrom + '%', width: fxWidth + '%', background: fxColor }} />
        <div className="db-tip" style={{ left: (50 + totalEnd) + '%', borderColor: total >= 0 ? assetColor : 'var(--loss)' }} />
      </div>
    );
  }

  /* ---------------- Sparkline ---------------- */
  function Spark({ pts, color, w = 130, h = 38, fill = true, sw = 1.75 }) {
    const min = Math.min(...pts), max = Math.max(...pts);
    const rng = max - min || 1;
    const step = w / (pts.length - 1);
    const Y = (v) => h - 4 - ((v - min) / rng) * (h - 8);
    const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${w},${h} L0,${h} Z`;
    const id = 'sp' + Math.round(min * 1000) + color.replace(/[^a-z0-9]/gi, '');
    return (
      <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
        {fill && (
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient></defs>
        )}
        {fill && <path d={area} fill={`url(#${id})`} />}
        <path d={line} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={w} cy={Y(pts[pts.length - 1])} r="2.4" fill={color} />
      </svg>
    );
  }

  /* ---------------- Area trend (with hover tooltip) ---------------- */
  function AreaTrend({ data, color = 'var(--gold)', height = 230, valFmt }) {
    const wrapRef = useRef(null);
    const [w, setW] = useState(640);
    const [hover, setHover] = useState(null);
    useEffect(() => {
      const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
      if (wrapRef.current) ro.observe(wrapRef.current);
      return () => ro.disconnect();
    }, []);
    const padL = 8, padR = 8, padT = 14, padB = 26;
    const iw = w - padL - padR, ih = height - padT - padB;
    const vals = data.map(d => d.v);
    const min = Math.min(...vals) * 0.985, max = Math.max(...vals) * 1.01;
    const rng = max - min || 1;
    const X = (i) => padL + (i / (data.length - 1)) * iw;
    const Y = (v) => padT + ih - ((v - min) / rng) * ih;
    const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(d.v).toFixed(1)}`).join(' ');
    const area = `${line} L${X(data.length - 1)},${padT + ih} L${X(0)},${padT + ih} Z`;
    const grids = 4;
    const onMove = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let i = Math.round(((x - padL) / iw) * (data.length - 1));
      i = Math.max(0, Math.min(data.length - 1, i));
      setHover(i);
    };
    const ticks = data.filter((_, i) => i % 6 === 0 || i === data.length - 1);
    return (
      <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
        <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs><linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.30" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient></defs>
          {Array.from({ length: grids + 1 }).map((_, g) => {
            const y = padT + (g / grids) * ih;
            return <line key={g} x1={padL} x2={w - padR} y1={y} y2={y} stroke="rgba(255,255,255,0.045)" strokeWidth="1" />;
          })}
          <path d={area} fill="url(#areaG)" />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          {ticks.map((d, k) => {
            const i = data.indexOf(d);
            return <text key={k} x={X(i)} y={height - 8} fill="var(--text-muted)" fontSize="10" textAnchor="middle" className="mono">{d.label}</text>;
          })}
          {hover != null && (
            <g>
              <line x1={X(hover)} x2={X(hover)} y1={padT} y2={padT + ih} stroke="var(--gold)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              <circle cx={X(hover)} cy={Y(data[hover].v)} r="4" fill="var(--gold)" stroke="var(--bg-base)" strokeWidth="2" />
            </g>
          )}
        </svg>
        {hover != null && (
          <div className="chart-tip" style={{ left: Math.min(Math.max(X(hover), 60), w - 60), top: padT }}>
            <div className="ct-label">{data[hover].label}</div>
            <div className="ct-val mono">{valFmt ? valFmt(data[hover].v) : data[hover].v}</div>
          </div>
        )}
      </div>
    );
  }

  /* ---------------- Overlapping FX areas over time ---------------- */
  function FXArea({ data, colors, keys, height = 230 }) {
    const wrapRef = useRef(null);
    const [w, setW] = useState(640);
    useEffect(() => {
      const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
      if (wrapRef.current) ro.observe(wrapRef.current);
      return () => ro.disconnect();
    }, []);
    const padL = 8, padR = 8, padT = 14, padB = 18;
    const iw = w - padL - padR, ih = height - padT - padB;
    let lo = 0, hi = 0;
    keys.forEach(k => data.forEach(d => { lo = Math.min(lo, d[k]); hi = Math.max(hi, d[k]); }));
    lo *= 1.1; hi *= 1.1;
    const rng = hi - lo || 1;
    const X = (i) => padL + (i / (data.length - 1)) * iw;
    const Y = (v) => padT + ih - ((v - lo) / rng) * ih;
    const zeroY = Y(0);
    return (
      <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
        <svg width={w} height={height}>
          <defs>
            {keys.map(k => (
              <linearGradient key={k} id={'fx' + k} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors[k]} stopOpacity="0.22" />
                <stop offset="100%" stopColor={colors[k]} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          <line x1={padL} x2={w - padR} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
          {keys.map(k => {
            const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(d[k]).toFixed(1)}`).join(' ');
            const area = `${line} L${X(data.length - 1)},${zeroY} L${X(0)},${zeroY} Z`;
            return <g key={k}><path d={area} fill={`url(#fx${k})`} /><path d={line} fill="none" stroke={colors[k]} strokeWidth="1.75" strokeLinejoin="round" /></g>;
          })}
        </svg>
      </div>
    );
  }

  window.PL = { NF, sgd, sgdSigned, pct, rate, useCountUp, Icon, Donut, Legend, Dumbbell, Spark, AreaTrend, FXArea };
})();
