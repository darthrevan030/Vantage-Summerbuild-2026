"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { EASE_OUT } from "./motion-config";

/* Word-by-word mask reveal (each word rises out of an overflow-hidden clip).
   Pass text with the part to emphasise wrapped in *asterisks* → rendered as
   gold italic. Reduced-motion → plain text, identical DOM. */
const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const word: Variants = {
  hidden: { y: "110%" },
  show: { y: "0%", transition: { duration: 0.7, ease: EASE_OUT } },
};

export function KineticHeadline({
  text,
  className = "",
  onView = false,
}: {
  text: string;
  className?: string;
  onView?: boolean;
}) {
  const reduce = useReducedMotion();
  const tokens = text.split(" ");

  const animateProps = onView
    ? { whileInView: "show" as const, viewport: { once: true, amount: 0.5 } }
    : { animate: "show" as const };

  return (
    <motion.h1
      className={className}
      variants={reduce ? undefined : container}
      initial={reduce ? false : "hidden"}
      {...(reduce ? {} : animateProps)}
    >
      {tokens.map((t, i) => {
        const emphasised = t.startsWith("*") && t.endsWith("*");
        const label = emphasised ? t.slice(1, -1) : t;
        return (
          <span key={i} className={"inline-block overflow-hidden align-bottom pb-[0.12em]" + (i < tokens.length - 1 ? " mr-[0.24em]" : "")}>
            <motion.span
              className={"inline-block" + (emphasised ? " italic text-gold" : "")}
              variants={reduce ? undefined : word}
            >
              {label}
              {i < tokens.length - 1 ? " " : ""}
            </motion.span>
          </span>
        );
      })}
    </motion.h1>
  );
}
