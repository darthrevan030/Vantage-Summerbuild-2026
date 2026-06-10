"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { applyAccent } from "@/lib/hexA";

interface TweakState {
  accent: string;
  lightMode: boolean;
}

const DARK_ACCENT = "#b79cff";
const LIGHT_ACCENT = "#6b4bd6";

/* Matches max-bp600 (width < 600px): the panel becomes a bottom sheet there */
const MOBILE_MQ = "(max-width: 599.98px)";

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2.5">
      <span className="text-xs font-medium text-[rgba(41,38,27,.72)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={
          "relative h-[18px] w-8 rounded-full border-0 p-0 transition-colors duration-150 " +
          (value ? "bg-[#34c759]" : "bg-black/15")
        }
      >
        <i
          className={
            "absolute left-0.5 top-0.5 block size-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.25)] transition-transform duration-150 " +
            (value ? "translate-x-3.5" : "translate-x-0")
          }
        />
      </button>
    </div>
  );
}

export function TweaksPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Initialise from the DOM: the root layout's theme script may have added
  // .light before this mounts — defaults here must mirror it, not stomp it.
  const [tw, setTw] = useState<TweakState>(() => {
    if (typeof document === "undefined") return { accent: DARK_ACCENT, lightMode: false };
    const light = document.documentElement.classList.contains("light");
    return { accent: light ? LIGHT_ACCENT : DARK_ACCENT, lightMode: light };
  });
  const dragRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 16, y: 16 });
  const PAD = 16;

  const setTweak = <K extends keyof TweakState>(key: K, val: TweakState[K]) => {
    setTw((prev) => ({ ...prev, [key]: val }));
  };

  useEffect(() => { applyAccent(tw.accent); }, [tw.accent]);
  useEffect(() => {
    document.documentElement.classList.toggle("light", tw.lightMode);
    // Sync the default accent to the active theme on toggle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tw.lightMode && tw.accent === DARK_ACCENT) setTweak("accent", LIGHT_ACCENT);
    if (!tw.lightMode && tw.accent === LIGHT_ACCENT) setTweak("accent", DARK_ACCENT);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tw.lightMode]);

  const clamp = useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    if (window.matchMedia(MOBILE_MQ).matches) {
      // Bottom sheet: positioning belongs to the classes, not inline styles
      panel.style.right = "";
      panel.style.bottom = "";
      return;
    }
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const maxX = Math.max(PAD, window.innerWidth - w - PAD);
    const maxY = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = { x: Math.min(maxX, Math.max(PAD, offsetRef.current.x)), y: Math.min(maxY, Math.max(PAD, offsetRef.current.y)) };
    panel.style.right = offsetRef.current.x + "px";
    panel.style.bottom = offsetRef.current.y + "px";
  }, []);

  useEffect(() => {
    if (!open) return;
    clamp();
    const ro = new ResizeObserver(clamp);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clamp]);

  const onDragStart = (e: React.MouseEvent) => {
    if (window.matchMedia(MOBILE_MQ).matches) return;
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      offsetRef.current = { x: startRight - (ev.clientX - sx), y: startBottom - (ev.clientY - sy) };
      clamp();
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  if (!open) return null;

  return (
    <div
      ref={dragRef}
      className={
        "fixed right-4 bottom-4 z-[2147483646] flex w-60 max-h-[calc(100vh-32px)] flex-col " +
        "rounded-[14px] border-[0.5px] border-white/60 bg-[rgba(250,249,247,.92)] text-[#29261b] " +
        "shadow-[0_1px_0_rgba(255,255,255,.5)_inset,0_12px_40px_rgba(0,0,0,.18)] " +
        "backdrop-blur-[24px] backdrop-saturate-[1.6] font-sans text-[11.5px] leading-[1.4] " +
        "max-bp600:inset-x-3 max-bp600:top-auto max-bp600:bottom-3 max-bp600:w-auto max-bp600:max-h-[70vh]"
      }
    >
      <div
        className="flex cursor-move select-none items-center justify-between py-2.5 pl-3.5 pr-2 max-bp600:cursor-default"
        onMouseDown={onDragStart}
      >
        <b className="text-xs font-semibold tracking-[.01em]">Tweaks</b>
        <button
          className="size-[22px] rounded-md border-0 bg-transparent text-[13px] text-[rgba(41,38,27,.55)]"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >✕</button>
      </div>
      <div className="flex flex-col gap-2.5 overflow-y-auto px-3.5 pb-3.5 pt-0.5">
        <div className="text-[10px] font-semibold uppercase tracking-[.06em] text-[rgba(41,38,27,.45)]">Appearance</div>
        <Toggle
          label="Light mode"
          value={tw.lightMode}
          onChange={(v) => {
            setTweak("lightMode", v);
            try { localStorage.setItem("theme", v ? "light" : "dark"); } catch {}
          }}
        />
        <div>
          <div className="mb-1.5 text-xs font-medium text-[rgba(41,38,27,.72)]">Accent colour</div>
          <label className="flex cursor-pointer items-center gap-2.5">
            <div
              className="relative size-8 shrink-0 overflow-hidden rounded-lg border-[0.5px] border-black/[.18] shadow-[0_2px_6px_rgba(0,0,0,.12)]"
              style={{ background: tw.accent }}
            >
              <input
                type="color"
                value={tw.accent}
                onChange={(e) => setTweak("accent", e.target.value)}
                className="absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)] cursor-pointer border-none p-0 opacity-0"
              />
            </div>
            <span className="font-mono text-xs tracking-[.04em] text-[rgba(41,38,27,.6)]">
              {tw.accent.toUpperCase()}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
