// Shared motion presets for the landing page. Plain data — no "use client".

import type { Transition } from "motion/react";

/** Signature easing used across reveals (matches the app's cubic-bezier(.2,.7,.2,1)). */
export const EASE_OUT = [0.2, 0.7, 0.2, 1] as const;

/** Smooth, slightly weighty spring for bars / handles / parallax. */
export const SPRING_SMOOTH: Transition = { type: "spring", stiffness: 160, damping: 26, mass: 0.4 };

/** Snappy spring for magnetic buttons and small UI. */
export const SPRING_SNAPPY: Transition = { type: "spring", stiffness: 300, damping: 22, mass: 0.3 };

/** Gentle spring for the subtle hero tilt. */
export const SPRING_TILT: Transition = { type: "spring", stiffness: 120, damping: 18, mass: 0.5 };

/** Reveal transition (fade + rise). */
export const REVEAL_TRANSITION: Transition = { duration: 0.6, ease: EASE_OUT };
