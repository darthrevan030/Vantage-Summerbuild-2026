"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useCountUp } from "@/lib/useCountUp";
import { sgd, sgdSigned, pct } from "@/lib/formatters";
import type { HeroStats } from "@/types/portfolio";

interface NerveBarProps {
  hero: HeroStats;
  animate?: boolean;
  onTweaksToggle?: () => void;
}

export function NerveBar({ hero, animate = true, onTweaksToggle }: NerveBarProps) {
  const total = useCountUp(hero.total, 1300, animate);
  const [spin, setSpin] = useState(false);
  const dayUp = hero.dayChange >= 0;

  return (
    <header className="nerve">
      <div className="wordmark">
        <span className="serif mark">PORTFOLIO</span>
        <span className="ui mark-sub">PERSONAL WEALTH TERMINAL</span>
      </div>
      <div className="nerve-center">
        <div className="mono hero-total">{sgd(total, 2)}</div>
        <div className="hero-day">
          <Icon name={dayUp ? "up" : "down"} size={13} style={{ color: dayUp ? "var(--gain)" : "var(--loss)" }} />
          <span className="mono" style={{ color: dayUp ? "var(--gain)" : "var(--loss)" }}>
            {sgdSigned(hero.dayChange)} ({pct(hero.dayPct)})
          </span>
        </div>
      </div>
      <div className="nerve-right">
        <div className="nr-fx mono">
          FX <span style={{ color: hero.fxImpact >= 0 ? "var(--fx-positive)" : "var(--fx-negative)" }}>
            {sgdSigned(hero.fxImpact)}
          </span>
        </div>
        <div className="nr-time mono">{hero.updated}</div>
        <button
          className={"refresh" + (spin ? " spin" : "")}
          onClick={() => { setSpin(true); setTimeout(() => setSpin(false), 800); }}
        >
          <Icon name="refresh" size={16} />
        </button>
        {onTweaksToggle && (
          <button className="refresh" onClick={onTweaksToggle} title="Tweaks">
            <Icon name="sliders" size={15} />
          </button>
        )}
      </div>
    </header>
  );
}
