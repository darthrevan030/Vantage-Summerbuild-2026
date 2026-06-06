"use client";

import { useState, useEffect, useRef } from "react";

interface FXAreaProps {
  data: Record<string, number>[];
  colors: Record<string, string>;
  keys: string[];
  height?: number;
}

export function FXArea({ data, colors, keys, height = 230 }: FXAreaProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);

  useEffect(() => {
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const padL = 8, padR = 8, padT = 14, padB = 18;
  const iw = w - padL - padR;
  const ih = height - padT - padB;

  let lo = 0, hi = 0;
  keys.forEach((k) => data.forEach((d) => { lo = Math.min(lo, d[k]); hi = Math.max(hi, d[k]); }));
  lo *= 1.1; hi *= 1.1;
  const rng = hi - lo || 1;

  const X = (i: number) => padL + (i / (data.length - 1)) * iw;
  const Y = (v: number) => padT + ih - ((v - lo) / rng) * ih;
  const zeroY = Y(0);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <svg width={w} height={height}>
        <defs>
          {keys.map((k) => (
            <linearGradient key={k} id={"fx" + k} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[k]} stopOpacity="0.22" />
              <stop offset="100%" stopColor={colors[k]} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        <line x1={padL} x2={w - padR} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        {keys.map((k) => {
          const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(d[k]).toFixed(1)}`).join(" ");
          const areaPath = `${linePath} L${X(data.length - 1)},${zeroY} L${X(0)},${zeroY} Z`;
          return (
            <g key={k}>
              <path d={areaPath} fill={`url(#fx${k})`} />
              <path d={linePath} fill="none" stroke={colors[k]} strokeWidth="1.75" strokeLinejoin="round" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
