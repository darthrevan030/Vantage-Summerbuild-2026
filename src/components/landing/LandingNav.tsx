"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function LandingNav() {
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
        (scrolled
          ? "border-b border-subtle bg-base/70 backdrop-blur-xl"
          : "border-b border-transparent")
      }
    >
      <div className="mx-auto flex h-16 max-w-[1140px] items-center justify-between px-6">
        <Link href="/" className="flex flex-col leading-none">
          <span className="font-serif text-xl text-gold [text-shadow:0_0_22px_var(--accent-glow)]">
            Portfolio
          </span>
          <span className="mt-1 text-[8.5px] font-medium tracking-[.22em] text-muted max-bp480:hidden">
            PERSONAL WEALTH TERMINAL
          </span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-full border border-subtle px-4.5 py-2 font-ui text-[13px] font-medium text-secondary transition-colors hover:border-gold-soft hover:text-primary"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-gold px-5 py-2 font-ui text-[13px] font-semibold text-[#15130c] transition-[filter,transform] hover:brightness-110 active:translate-y-px"
          >
            Get Started
          </Link>
        </nav>
      </div>
    </header>
  );
}
