"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Icon } from "@/components/Icon";
import { ICON_BTN } from "@/components/TabBar";
import { CountUp } from "@/components/landing/CountUp";
import { pct, CCY_SYMBOL, ccyFmt } from "@/lib/formatters";
import { useCurrencies } from "@/hooks/useCurrencies";
import { usePortfolio } from "@/context/portfolio";
import { createClient } from "@/lib/supabase/client";
import { refreshHoldingPrices } from "@/lib/api-client";
import type { HeroStats } from "@/types/portfolio";

interface NerveBarProps {
  hero: HeroStats;
  animate?: boolean;
  onTweaksToggle?: () => void;
  onHamburger?: () => void;
}

export function NerveBar({
  hero,
  animate = true,
  onTweaksToggle,
  onHamburger,
}: NerveBarProps) {
  const { displayName, fmtSigned, baseCurrency, setBaseCurrency, toBase } =
    usePortfolio();
  const currencies = useCurrencies();
  const [spin, setSpin] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [ccyOpen, setCcyOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; right: number } | null>(
    null,
  );
  const ccyRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const ccyBtnRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const dayUp = hero.dayChange >= 0;

  useEffect(() => {
    if (!ccyOpen) return;
    function handleOutside(e: MouseEvent) {
      const inBtn = ccyRef.current?.contains(e.target as Node);
      const inDrop = dropRef.current?.contains(e.target as Node);
      if (!inBtn && !inDrop) setCcyOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [ccyOpen]);

  function handleCcyToggle() {
    if (!ccyOpen && ccyBtnRef.current) {
      const r = ccyBtnRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setCcyOpen((v) => !v);
  }

  async function switchCurrency(c: string) {
    setBaseCurrency(c);
    setCcyOpen(false);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseCurrency: c }),
    });
    if (res.ok) toast.success(`Base currency set to ${c}`);
    else toast.error("Failed to save base currency");
  }

  const wordmark = displayName ? `${displayName}'s Vantage` : "VANTAGE";

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-50 grid h-[62px] flex-[0_0_62px] grid-cols-[1fr_auto_1fr] items-center overflow-hidden border-b border-subtle bg-[rgba(8,9,15,0.72)] px-[26px] backdrop-blur-[14px] max-bp768:grid-cols-[auto_1fr_auto] max-bp768:gap-1.5 max-bp768:px-4 max-bp600:px-3 max-bp480:h-[52px] max-bp380:px-2 light:bg-[rgba(236,234,244,0.86)]">
      <div className="flex flex-col leading-none">
        <span className="font-serif text-[22px] tracking-[.4px] text-gold [text-shadow:0_0_22px_var(--accent-glow)] max-bp768:text-[17px] max-bp600:text-[15px] max-bp480:text-[14px] max-bp380:text-[13px]">
          {wordmark}
        </span>
        <span className="mt-[3px] font-ui text-[9px] font-medium tracking-[.22em] text-muted max-bp600:hidden">
          PERSONAL WEALTH TERMINAL
        </span>
      </div>
      <div className="relative text-center before:pointer-events-none before:absolute before:left-1/2 before:top-1/2 before:h-[120px] before:w-[340px] before:-translate-x-1/2 before:-translate-y-1/2 before:bg-[radial-gradient(60%_70%_at_50%_50%,var(--accent-glow)_0%,transparent_70%)] before:opacity-70 before:blur-[6px] before:content-['']">
        <div className="relative font-mono text-[28px] font-semibold leading-none tracking-[-.02em] tabular-nums max-bp900:text-[24px] max-bp768:text-[21px] max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px] max-bp380:tracking-[-.01em]">
          {animate ? (
            <CountUp
              to={toBase(hero.total)}
              format={(v) => ccyFmt(v, baseCurrency)}
              durationMs={900}
              startOnView={false}
            />
          ) : (
            ccyFmt(toBase(hero.total), baseCurrency)
          )}
        </div>
        <div className="mt-[3px] flex items-center justify-center gap-[5px] text-xs max-bp768:text-[11px] max-bp600:text-[10.5px] max-bp380:hidden">
          <Icon
            name={dayUp ? "up" : "down"}
            size={13}
            style={{ color: dayUp ? "var(--gain)" : "var(--loss)" }}
          />
          <span
            className="font-mono tabular-nums"
            style={{ color: dayUp ? "var(--gain)" : "var(--loss)" }}
          >
            {fmtSigned(hero.dayChange)} ({pct(hero.dayPct)})
          </span>
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2.5 overflow-visible">
        <div className="rounded-lg border border-subtle bg-elevated px-[11px] py-[5px] font-mono text-xs tabular-nums text-secondary max-bp600:hidden">
          FX{" "}
          <span
            style={{
              color:
                hero.fxImpact >= 0
                  ? "var(--fx-positive)"
                  : "var(--fx-negative)",
            }}
          >
            {fmtSigned(hero.fxImpact)}
          </span>
        </div>
        <div className="relative" ref={ccyRef}>
          <button
            ref={ccyBtnRef}
            className="cursor-pointer select-none rounded-[7px] border border-gold-soft bg-wash px-[9px] py-1 font-mono text-[11px] font-semibold tracking-[.06em] tabular-nums text-gold transition-[filter] duration-150 hover:brightness-[1.15]"
            onClick={handleCcyToggle}
            title="Switch base currency"
          >
            {CCY_SYMBOL[baseCurrency] ?? baseCurrency} {baseCurrency} ▾
          </button>
          {ccyOpen &&
            dropPos &&
            createPortal(
              <div
                ref={dropRef}
                className="fixed z-[9999] flex min-w-[130px] flex-col gap-0.5 rounded-xl border border-subtle bg-surface p-1.5 shadow-[0_8px_32px_rgba(0,0,0,.5)] animate-fade-slide-in"
                style={{ top: dropPos.top, right: dropPos.right }}
              >
                {currencies.map((c) => (
                  <button
                    key={c}
                    className={
                      "flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-[7px] text-left text-xs transition-[background,color] duration-[120ms] " +
                      (c === baseCurrency
                        ? "bg-wash text-gold"
                        : "text-secondary hover:bg-elevated hover:text-primary")
                    }
                    onClick={() => switchCurrency(c)}
                  >
                    <span className="min-w-7 font-mono text-[13px] font-bold tabular-nums">
                      {CCY_SYMBOL[c] ?? c}
                    </span>
                    <span className="font-ui">{c}</span>
                  </button>
                ))}
              </div>,
              document.body,
            )}
        </div>
        <div className="font-mono text-xs tabular-nums text-muted max-bp768:hidden">
          {hero.updated}
        </div>
        {/* Desktop-only action buttons */}
        <div className="flex items-center gap-2 max-bp600:hidden">
          <button
            className={ICON_BTN}
            onClick={async () => {
              setSpin(true);
              try {
                const { refreshed } = await refreshHoldingPrices();
                toast.success(
                  refreshed > 0
                    ? `Refreshed ${refreshed} price${refreshed > 1 ? "s" : ""}`
                    : "Prices already up to date",
                );
                router.refresh();
              } catch {
                toast.error("Price refresh failed");
              } finally {
                setSpin(false);
              }
            }}
            title="Refresh prices"
            disabled={spin}
          >
            <Icon
              name="refresh"
              size={16}
              className={spin ? "animate-spin-once" : ""}
            />
          </button>
          {onTweaksToggle && (
            <button
              className={ICON_BTN}
              onClick={onTweaksToggle}
              title="Tweaks"
            >
              <Icon name="sliders" size={15} />
            </button>
          )}
          <button
            className={ICON_BTN}
            onClick={handleLogout}
            disabled={loggingOut}
            title="Log out"
            style={{ opacity: loggingOut ? 0.5 : 1 }}
          >
            <Icon name="logout" size={15} />
          </button>
        </div>
        {/* Mobile-only hamburger */}
        {onHamburger && (
          <button
            className="hidden size-[34px] shrink-0 cursor-pointer place-items-center rounded-[9px] border border-subtle bg-surface text-secondary transition-[color,border-color,background] duration-200 hover:border-gold-soft hover:text-gold max-bp600:grid"
            onClick={onHamburger}
            title="Menu"
          >
            <Icon name="menu" size={18} />
          </button>
        )}
      </div>
    </header>
  );
}
