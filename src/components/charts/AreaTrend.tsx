"use client";

import { useState, useEffect, useRef } from "react";

interface DataPoint {
  label: string;
  v: number;
}

interface AreaTrendProps {
  data: DataPoint[];
  color?: string;
  height?: number;
  valFmt?: (v: number) => string;
}

export function AreaTrend({ data, color = "var(--gold)", height = 230, valFmt }: AreaTrendProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const padL = 8, padR = 8, padT = 14, padB = 26;
  const iw = w - padL - padR;
  const ih = height - padT - padB;
  const vals = data.map((d) => d.v);
  const min = Math.min(...vals) * 0.985;
  const max = Math.max(...vals) * 1.01;
  const rng = max - min || 1;
  const X = (i: number) => padL + (i / (data.length - 1)) * iw;
  const Y = (v: number) => padT + ih - ((v - min) / rng) * ih;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(d.v).toFixed(1)}`).join(" ");
  const area = `${line} L${X(data.length - 1)},${padT + ih} L${X(0)},${padT + ih} Z`;
  const grids = 4;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let i = Math.round(((x - padL) / iw) * (data.length - 1));
    i = Math.max(0, Math.min(data.length - 1, i));
    setHover(i);
  };

  const ticks = data.filter((_, i) => i % 6 === 0 || i === data.length - 1);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.30" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: grids + 1 }).map((_, g) => {
          const y = padT + (g / grids) * ih;
          return <line key={g} x1={padL} x2={w - padR} y1={y} y2={y} stroke="rgba(255,255,255,0.045)" strokeWidth="1" />;
        })}
        <path d={area} fill="url(#areaG)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {ticks.map((d, k) => {
          const i = data.indexOf(d);
          return (
            <text key={k} x={X(i)} y={height - 8} fill="var(--text-muted)" fontSize="10" textAnchor="middle" className="mono">
              {d.label}
            </text>
          );
        })}
        {hover != null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={padT} y2={padT + ih} stroke="var(--gold)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <circle cx={X(hover)} cy={Y(data[hover].v)} r="4" fill="var(--gold)" stroke="var(--bg-base)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          className="chart-tip"
          style={{ left: Math.min(Math.max(X(hover), 60), w - 60), top: padT }}
        >
          <div className="ct-label">{data[hover].label}</div>
          <div className="ct-val mono">{valFmt ? valFmt(data[hover].v) : data[hover].v}</div>
        </div>
      )}
    </div>
  );
}
