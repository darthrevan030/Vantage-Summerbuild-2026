"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MagneticButton } from "./MagneticButton";

export function LandingNav() {
  const reduce = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={
        "fixed inset-x-0 top-0 z-50 transition-colors duration-200 " +
        (scrolled ? "border-b border-subtle bg-base/70 backdrop-blur-xl" : "border-b border-transparent")
      }
    >
      <div className="mx-auto flex h-16 max-w-[1140px] items-center justify-between px-6">
        <Link href="/" className="flex flex-col leading-none">
          <motion.span
            className="bg-[linear-gradient(110deg,var(--gold)_0%,color-mix(in_oklab,var(--gold),white_65%)_50%,var(--gold)_100%)] [background-size:200%_100%] bg-clip-text font-serif text-xl text-transparent [filter:drop-shadow(0_0_18px_var(--accent-glow))]"
            animate={reduce ? undefined : { backgroundPositionX: ["0%", "-200%"] }}
            transition={reduce ? undefined : { duration: 7, repeat: Infinity, ease: "linear" }}
          >
            Portfolio
          </motion.span>
          <span className="mt-1 text-[8.5px] font-medium tracking-[.22em] text-muted max-bp480:hidden">
            PERSONAL WEALTH TERMINAL
          </span>
        </Link>
        <nav className="flex items-center gap-3">
          <MagneticButton
            href="/login"
            radius={60}
            className="rounded-full border border-subtle px-4.5 py-2 font-ui text-[13px] font-medium text-secondary transition-colors hover:border-gold-soft hover:text-primary"
          >
            Sign in
          </MagneticButton>
          <MagneticButton
            href="/login"
            className="rounded-full bg-gold px-5 py-2 font-ui text-[13px] font-semibold text-[#15130c] transition-[filter] hover:brightness-110"
          >
            Get Started
          </MagneticButton>
        </nav>
      </div>
    </header>
  );
}
