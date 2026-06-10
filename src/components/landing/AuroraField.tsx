"use client";

import { useEffect, useRef } from "react";

/* Ambient Canvas2D "aurora field" — drifting additive light blobs + faint
   particles + a cursor-reactive spotlight. Landing-scoped (mounted in page.tsx,
   unmounts on nav). Sits behind the static body::after aurora and blends
   additively, so no-JS gracefully falls back to that gradient.

   Perf: DPR<=2, half-res offscreen for the blobs, single rAF loop, paused on
   tab-hidden, pointer coalesced into the tick, ResizeObserver. Reduced-motion
   or low-end → one static frame, no loop. */

type Blob = { hx: number; hy: number; r: number; col: [number, number, number]; px: number; py: number; sp: number };

function parseColor(scratch: CanvasRenderingContext2D, css: string): [number, number, number] {
  scratch.clearRect(0, 0, 1, 1);
  scratch.fillStyle = "#000";
  scratch.fillStyle = css; // invalid strings are ignored, leaving the prior value
  scratch.fillRect(0, 0, 1, 1);
  const [r, g, b] = scratch.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

export function AuroraField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scratch = document.createElement("canvas");
    scratch.width = scratch.height = 1;
    const sctx = scratch.getContext("2d", { willReadFrequently: true })!;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fpsCap = lowEnd ? 30 : 60;

    // half-res offscreen for cheap bloom
    const off = document.createElement("canvas");
    const octx = off.getContext("2d")!;

    let W = 0, H = 0;
    type RGB = [number, number, number];
    const palette: Record<"glow" | "blue" | "mag" | "gold", RGB> = {
      glow: [150, 110, 255], blue: [111, 176, 255], mag: [229, 138, 208], gold: [183, 156, 255],
    };

    function readPalette() {
      const cs = getComputedStyle(document.documentElement);
      palette.glow = parseColor(sctx, cs.getPropertyValue("--accent-glow").trim() || "rgb(150,110,255)");
      palette.blue = parseColor(sctx, cs.getPropertyValue("--fx-positive").trim() || "rgb(111,176,255)");
      palette.mag = parseColor(sctx, cs.getPropertyValue("--fx-negative").trim() || "rgb(229,138,208)");
      palette.gold = parseColor(sctx, cs.getPropertyValue("--gold").trim() || "rgb(183,156,255)");
      assignBlobColors();
    }

    const blobs: Blob[] = [
      { hx: 0.5, hy: -0.05, r: 0.9, col: palette.glow, px: 0, py: 0, sp: 0.6 },
      { hx: 0.88, hy: 0.08, r: 0.6, col: palette.blue, px: 1.7, py: 0.5, sp: 0.45 },
      { hx: 0.08, hy: 0.15, r: 0.55, col: palette.mag, px: 3.1, py: 1.2, sp: 0.5 },
      { hx: 0.32, hy: 0.55, r: 0.5, col: palette.gold, px: 4.4, py: 2.0, sp: 0.4 },
      { hx: 0.7, hy: 0.7, r: 0.6, col: palette.glow, px: 5.9, py: 3.3, sp: 0.35 },
    ];
    function assignBlobColors() {
      blobs[0].col = palette.glow; blobs[1].col = palette.blue; blobs[2].col = palette.mag;
      blobs[3].col = palette.gold; blobs[4].col = palette.glow;
    }

    let particles: { x: number; y: number; r: number; a: number; vy: number }[] = [];
    function seedParticles() {
      const base = coarse || lowEnd ? 22 : 56;
      const count = Math.round(base * Math.min(1.4, (W * H) / (1440 * 900)));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.6 + Math.random() * 1.4, a: 0.03 + Math.random() * 0.07,
        vy: 4 + Math.random() * 10,
      }));
    }

    const pointer = { x: 0.5, y: 0.3, tx: 0.5, ty: 0.3, active: false };

    function resize() {
      W = canvas!.clientWidth; H = canvas!.clientHeight;
      canvas!.width = Math.round(W * dpr); canvas!.height = Math.round(H * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const oscale = 0.5;
      off.width = Math.max(1, Math.round(W * oscale)); off.height = Math.max(1, Math.round(H * oscale));
      seedParticles();
    }

    function drawBlobs(t: number) {
      const ow = off.width, oh = off.height;
      octx.clearRect(0, 0, ow, oh);
      octx.globalCompositeOperation = "lighter";
      for (const b of blobs) {
        // incommensurate drift → never visibly loops
        const dx = Math.sin(t * 0.06 * b.sp + b.px) * 0.06 + Math.sin(t * 0.013 * b.sp + b.py) * 0.04;
        const dy = Math.cos(t * 0.05 * b.sp + b.py) * 0.05 + Math.sin(t * 0.017 * b.sp + b.px) * 0.03;
        // ease toward pointer for parallax
        const cx = (b.hx + dx + (pointer.x - 0.5) * 0.05) * ow;
        const cy = (b.hy + dy + (pointer.y - 0.5) * 0.05) * oh;
        const rad = b.r * Math.max(ow, oh);
        const [r, g, bl] = b.col;
        const grd = octx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        // Subtle: a gentle violet glow over the near-black base, not a wash.
        grd.addColorStop(0, `rgba(${r},${g},${bl},0.16)`);
        grd.addColorStop(0.5, `rgba(${r},${g},${bl},0.04)`);
        grd.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        octx.fillStyle = grd;
        octx.fillRect(0, 0, ow, oh);
      }
      octx.globalCompositeOperation = "source-over";
    }

    function drawFrame() {
      ctx!.clearRect(0, 0, W, H);
      // upscaled half-res blobs = cheap blur
      ctx!.imageSmoothingEnabled = true;
      ctx!.drawImage(off, 0, 0, W, H);

      // cursor spotlight
      const sx = pointer.x * W, sy = pointer.y * H;
      const [gr, gg, gb] = palette.gold;
      const sg = ctx!.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.26);
      sg.addColorStop(0, `rgba(${gr},${gg},${gb},${pointer.active ? 0.2 : 0.05})`);
      sg.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
      ctx!.globalCompositeOperation = "lighter";
      ctx!.fillStyle = sg;
      ctx!.fillRect(0, 0, W, H);

      // particles
      for (const p of particles) {
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${gr},${gg},${gb},${p.a})`;
        ctx!.fill();
      }
      ctx!.globalCompositeOperation = "source-over";
    }

    function step(dt: number, t: number) {
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      for (const p of particles) {
        p.y -= p.vy * dt;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
      }
      drawBlobs(t);
      drawFrame();
    }

    readPalette();
    resize();

    let raf = 0, last = 0, acc = 0, running = false;
    const minDt = 1 / fpsCap;
    function loop(now: number) {
      raf = requestAnimationFrame(loop);
      const t = now / 1000;
      const dt = last ? Math.min(0.05, t - last) : 0.016;
      last = t;
      acc += dt;
      if (acc < minDt) return;
      step(acc, t);
      acc = 0;
    }
    function start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(loop); } }
    function stop() { running = false; cancelAnimationFrame(raf); }

    if (reduce) {
      // single static frame, no loop
      drawBlobs(2.1);
      drawFrame();
    } else {
      start();
    }

    // auto-drift the spotlight target on touch / no fine pointer
    let driftRaf = 0;
    function autodrift(now: number) {
      driftRaf = requestAnimationFrame(autodrift);
      pointer.tx = 0.5 + Math.sin(now / 4200) * 0.3;
      pointer.ty = 0.4 + Math.cos(now / 5300) * 0.25;
    }
    if (coarse && !reduce) driftRaf = requestAnimationFrame(autodrift);

    const onPointer = (e: PointerEvent) => {
      pointer.tx = e.clientX / window.innerWidth;
      pointer.ty = e.clientY / window.innerHeight;
      pointer.active = true;
    };
    const onLeave = () => { pointer.active = false; };
    const onVis = () => { if (document.hidden) stop(); else if (!reduce) start(); };

    if (!coarse) window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerout", onLeave, { passive: true });

    const ro = new ResizeObserver(() => { resize(); if (reduce) { drawBlobs(2.1); drawFrame(); } });
    ro.observe(canvas);

    const mo = new MutationObserver(() => { readPalette(); if (reduce) { drawBlobs(2.1); drawFrame(); } });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

    return () => {
      stop();
      cancelAnimationFrame(driftRaf);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerout", onLeave);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
