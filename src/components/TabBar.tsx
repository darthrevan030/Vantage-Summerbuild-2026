"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/client";
import { refreshHoldingPrices } from "@/lib/api-client";
import { usePortfolio } from "@/context/portfolio";
import { SPRING_SMOOTH } from "@/components/landing/motion-config";

const TABS = [
  { label: "Overview",     href: "/overview",  icon: "layout-dashboard" },
  { label: "Holdings",     href: "/holdings",  icon: "list"             },
  { label: "FX Lab",       href: "/fx-lab",    icon: "repeat"           },
  { label: "Charts",       href: "/charts",    icon: "bar-chart"        },
  { label: "Analysis",     href: "/analysis",  icon: "sparkles"         },
  { label: "Add / Import", href: "/add",       icon: "circle-plus"      },
];

const TAB_BASE =
  "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-3.5 font-ui text-[13.5px] font-medium transition-colors duration-[180ms] " +
  "max-bp768:px-2.5 max-bp768:text-[12.5px] max-bp600:px-2 max-bp600:py-[13px] max-bp600:text-[12px] " +
  "max-bp480:px-[7px] max-bp480:py-2.5 max-bp480:text-[11.5px] max-bp380:px-1.5 max-bp380:text-[11px]";
const TAB_ACTIVE = "text-primary";
const TAB_IDLE = "text-secondary hover:text-primary";
const UNDERLINE =
  "absolute inset-x-3.5 bottom-0 h-0.5 rounded-t-[2px] bg-gold shadow-[0_0_12px_var(--accent-glow)]";

const MM_LINK =
  "flex items-center gap-[13px] px-5 py-3.5 font-ui text-sm font-medium transition-[color,background] duration-150";
const MM_ACTION =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] border border-subtle px-3.5 py-[11px] font-ui text-[13px] text-secondary transition-[color,border-color,background] duration-150";
// Square icon button, shared with NerveBar's action row.
export const ICON_BTN =
  "grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-[9px] border border-subtle bg-surface text-secondary transition-[color,border-color,background] duration-200 hover:border-gold-soft hover:text-gold";

interface TabBarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onTweaksToggle?: () => void;
}

export function TabBar({ mobileOpen = false, onMobileClose, onTweaksToggle }: TabBarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const reduce   = useReducedMotion();
  const { displayName } = usePortfolio();

  // Close drawer on route change
  useEffect(() => { onMobileClose?.(); }, [pathname]);

  // Shared sliding underline — only the active tab mounts it; the layoutId
  // animates it between tabs on navigation (instant under reduced-motion).
  const underline = (
    <motion.span layoutId="tab-underline" className={UNDERLINE} transition={reduce ? { duration: 0 } : SPRING_SMOOTH} />
  );

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function handleRefresh() {
    try {
      const { refreshed } = await refreshHoldingPrices();
      toast.success(
        refreshed > 0
          ? `Refreshed ${refreshed} price${refreshed > 1 ? "s" : ""}`
          : "Prices already up to date"
      );
      router.refresh();
    } catch {
      toast.error("Price refresh failed");
    }
    onMobileClose?.();
  }

  return (
    <>
      {/* Desktop horizontal tab bar */}
      <nav className="sticky top-[62px] z-40 flex h-12 items-center gap-1.5 overflow-x-auto border-b border-subtle bg-[rgba(8,9,15,0.72)] px-[22px] backdrop-blur-[14px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-bp768:gap-0.5 max-bp768:px-2.5 max-bp600:hidden max-bp480:h-[42px] light:bg-[rgba(236,234,244,0.86)]">
        {TABS.map(({ label, href, icon }) => (
          <Link
            key={href}
            href={href}
            className={`${TAB_BASE} ${pathname === href ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <Icon name={icon} size={13} strokeWidth={1.9} />
            {label}
            {pathname === href && underline}
          </Link>
        ))}
        <div className="flex-1" />
        <Link
          href="/settings"
          className={`${TAB_BASE} ${pathname === "/settings" ? TAB_ACTIVE : TAB_IDLE}`}
          title="Settings"
        >
          <Icon name="settings" size={13} strokeWidth={1.9} />
          Settings
          {pathname === "/settings" && underline}
        </Link>
      </nav>

      {/* Mobile slide-out drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[300] bg-black/65 backdrop-blur-[4px] animate-mm-fade" onClick={onMobileClose}>
          <div className="absolute inset-y-0 left-0 flex w-[72%] max-w-72 flex-col border-r border-subtle bg-surface animate-mm-slide" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b border-subtle px-[18px] pb-4 pt-[18px]">
              <span className="font-serif text-[17px] tracking-[.3px] text-gold">{displayName ? `${displayName}'s Portfolio` : "Portfolio"}</span>
              <button className={ICON_BTN} onClick={onMobileClose} title="Close">
                <Icon name="x" size={16} />
              </button>
            </div>

            <nav className="flex flex-1 flex-col overflow-y-auto py-2">
              {TABS.map(({ label, href, icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`${MM_LINK} ${pathname === href ? "bg-wash text-gold" : "text-secondary hover:bg-elevated hover:text-primary"}`}
                  onClick={onMobileClose}
                >
                  <Icon name={icon} size={16} strokeWidth={1.7} />
                  {label}
                </Link>
              ))}
              <Link
                href="/settings"
                className={`${MM_LINK} ${pathname === "/settings" ? "bg-wash text-gold" : "text-secondary hover:bg-elevated hover:text-primary"}`}
                onClick={onMobileClose}
              >
                <Icon name="settings" size={16} strokeWidth={1.7} />
                Settings
              </Link>
            </nav>

            <div className="flex shrink-0 flex-col gap-1.5 border-t border-subtle px-3.5 pb-5 pt-3">
              <button className={`${MM_ACTION} hover:border-muted hover:bg-elevated hover:text-primary`} onClick={handleRefresh}>
                <Icon name="refresh" size={15} />
                Refresh prices
              </button>
              {onTweaksToggle && (
                <button
                  className={`${MM_ACTION} hover:border-muted hover:bg-elevated hover:text-primary`}
                  onClick={() => {
                    onMobileClose?.();
                    onTweaksToggle();
                  }}
                >
                  <Icon name="sliders" size={15} />
                  Appearance
                </button>
              )}
              <button className={`${MM_ACTION} hover:border-loss hover:text-loss`} onClick={handleLogout}>
                <Icon name="logout" size={15} />
                Log out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
