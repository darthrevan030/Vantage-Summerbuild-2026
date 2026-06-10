"use client";

import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "./motion-config";

/* Fade + 14px rise on first scroll-into-view. Reduced-motion mounts visible
   (initial={false}); the page's <noscript> rule keeps content visible without JS. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      data-reveal
      className={className}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.6, ease: EASE_OUT, delay: delay / 1000 }}
    >
      {children}
    </motion.div>
  );
}
