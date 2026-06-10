"use client";

import { useEffect, useRef, useState } from "react";

/* Fire-once scroll reveal: fade + 14px rise. Under prefers-reduced-motion
   the hidden state is skipped entirely (no snap-in from the global
   transition kill-switch). A <noscript> rule in the page guarantees
   visibility without JS. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Intentional: reveal immediately, no observer, no animation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-reveal
      className={
        className +
        " transition-[opacity,transform] duration-[600ms] ease-[cubic-bezier(.2,.7,.2,1)] " +
        (shown ? "translate-y-0 opacity-100" : "translate-y-3.5 opacity-0")
      }
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
