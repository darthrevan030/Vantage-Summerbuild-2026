"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { applyAccent } from "@/lib/hexA";

const DARK_ACCENTS = ["#b79cff", "#7c9cff", "#5fd0c6", "#e58ad0"];
const LIGHT_ACCENTS = ["#6b4bd6", "#2563c9", "#0f8f80", "#b8458f"];

interface TweakState {
  accent: string;
  lightMode: boolean;
  grain: boolean;
  motion: boolean;
}

const DEFAULTS: TweakState = {
  accent: "#b79cff",
  lightMode: false,
  grain: true,
  motion: true,
};

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <span style={{ fontSize: 12, color: "rgba(41,38,27,.72)", fontWeight: 500 }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        style={{
          position: "relative", width: 32, height: 18, border: 0, borderRadius: 999,
          background: value ? "#34c759" : "rgba(0,0,0,.15)", transition: "background .15s", cursor: "default", padding: 0,
        }}
      >
        <i style={{
          position: "absolute", top: 2, left: 2, width: 14, height: 14, borderRadius: "50%",
          background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.25)",
          transition: "transform .15s", transform: value ? "translateX(14px)" : "translateX(0)",
          display: "block",
        }} />
      </button>
    </div>
  );
}

export function TweaksPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tw, setTw] = useState<TweakState>(DEFAULTS);
  const dragRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 16, y: 16 });
  const PAD = 16;

  const setTweak = <K extends keyof TweakState>(key: K, val: TweakState[K]) => {
    setTw((prev) => ({ ...prev, [key]: val }));
  };

  useEffect(() => { applyAccent(tw.accent); }, [tw.accent]);
  useEffect(() => { document.body.classList.toggle("no-grain", !tw.grain); }, [tw.grain]);
  useEffect(() => { document.body.classList.toggle("no-motion", !tw.motion); }, [tw.motion]);
  useEffect(() => {
    document.documentElement.classList.toggle("light", tw.lightMode);
    if (tw.lightMode && tw.accent === "#b79cff") setTweak("accent", "#6b4bd6");
    if (!tw.lightMode && tw.accent === "#6b4bd6") setTweak("accent", "#b79cff");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tw.lightMode]);

  const clamp = useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
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

  const accents = tw.lightMode ? LIGHT_ACCENTS : DARK_ACCENTS;

  return (
    <div
      ref={dragRef}
      style={{
        position: "fixed", right: offsetRef.current.x, bottom: offsetRef.current.y,
        zIndex: 2147483646, width: 280, maxHeight: "calc(100vh - 32px)",
        display: "flex", flexDirection: "column",
        background: "rgba(250,249,247,.92)", color: "#29261b",
        backdropFilter: "blur(24px) saturate(160%)", WebkitBackdropFilter: "blur(24px) saturate(160%)",
        border: ".5px solid rgba(255,255,255,.6)", borderRadius: 14,
        boxShadow: "0 1px 0 rgba(255,255,255,.5) inset, 0 12px 40px rgba(0,0,0,.18)",
        font: "11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 8px 10px 14px", cursor: "move", userSelect: "none" }}
        onMouseDown={onDragStart}
      >
        <b style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".01em" }}>Tweaks</b>
        <button
          style={{ appearance: "none", border: 0, background: "transparent", color: "rgba(41,38,27,.55)", width: 22, height: 22, borderRadius: 6, cursor: "default", fontSize: 13 }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >✕</button>
      </div>
      <div style={{ padding: "2px 14px 14px", display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(41,38,27,.45)", paddingTop: 0 }}>Appearance</div>
        <Toggle label="Light mode" value={tw.lightMode} onChange={(v) => setTweak("lightMode", v)} />
        <div>
          <div style={{ fontSize: 12, color: "rgba(41,38,27,.72)", fontWeight: 500, marginBottom: 6 }}>Accent</div>
          <div style={{ display: "flex", gap: 6 }}>
            {accents.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setTweak("accent", color)}
                style={{
                  flex: 1, height: 28, border: tw.accent === color ? "2px solid rgba(0,0,0,.85)" : ".5px solid rgba(0,0,0,.12)",
                  borderRadius: 6, background: color, cursor: "default",
                  boxShadow: tw.accent === color ? "0 2px 6px rgba(0,0,0,.15)" : "none",
                }}
              />
            ))}
          </div>
        </div>
        <Toggle label="Film grain" value={tw.grain} onChange={(v) => setTweak("grain", v)} />
        <Toggle label="Motion" value={tw.motion} onChange={(v) => setTweak("motion", v)} />
      </div>
    </div>
  );
}
