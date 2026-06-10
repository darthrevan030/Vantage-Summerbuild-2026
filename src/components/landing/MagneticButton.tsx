"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "motion/react";
import { SPRING_SNAPPY } from "./motion-config";

const MotionLink = motion.create(Link);

/* Pointer-magnetic button: translates toward the cursor within `radius`, springs
   back on leave. Renders a Link (href) or button. Reduced-motion → no magnet. */
export function MagneticButton({
  href,
  onClick,
  className = "",
  radius = 90,
  strength = 0.4,
  children,
}: {
  href?: string;
  onClick?: () => void;
  className?: string;
  radius?: number;
  strength?: number;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement | null>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, SPRING_SNAPPY);
  const y = useSpring(my, SPRING_SNAPPY);

  function onMove(e: React.PointerEvent) {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < radius + Math.max(r.width, r.height) / 2) {
      mx.set(dx * strength);
      my.set(dy * strength);
    }
  }
  const reset = () => { mx.set(0); my.set(0); };

  if (href) {
    return (
      <MotionLink
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={className}
        style={{ x, y }}
        onPointerMove={onMove}
        onPointerLeave={reset}
        whileTap={reduce ? undefined : { scale: 0.97 }}
      >
        {children}
      </MotionLink>
    );
  }
  return (
    <motion.button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      onClick={onClick}
      className={className}
      style={{ x, y }}
      onPointerMove={onMove}
      onPointerLeave={reset}
      whileTap={reduce ? undefined : { scale: 0.97 }}
    >
      {children}
    </motion.button>
  );
}
