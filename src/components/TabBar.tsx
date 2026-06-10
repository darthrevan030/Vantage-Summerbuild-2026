"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "react-toastify";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/client";
import { refreshHoldingPrices } from "@/lib/api-client";
import { usePortfolio } from "@/context/portfolio";

const TABS = [
  { label: "Overview",     href: "/overview",  icon: "layout-dashboard" },
  { label: "Holdings",     href: "/holdings",  icon: "list"             },
  { label: "FX Lab",       href: "/fx-lab",    icon: "repeat"           },
  { label: "Charts",       href: "/charts",    icon: "bar-chart"        },
  { label: "Analysis",     href: "/analysis",  icon: "sparkles"         },
  { label: "Add / Import", href: "/add",       icon: "circle-plus"      },
];

interface TabBarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onTweaksToggle?: () => void;
}

export function TabBar({ mobileOpen = false, onMobileClose, onTweaksToggle }: TabBarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const { displayName } = usePortfolio();

  // Close drawer on route change
  useEffect(() => { onMobileClose?.(); }, [pathname]);

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
      <nav className="tabbar">
        {TABS.map(({ label, href, icon }) => (
          <Link
            key={href}
            href={href}
            className={"tab" + (pathname === href ? " active" : "")}
          >
            <Icon name={icon} size={13} strokeWidth={1.9} />
            {label}
          </Link>
        ))}
        <div className="tab-spacer" />
        <Link
          href="/settings"
          className={"tab tab-settings" + (pathname === "/settings" ? " active" : "")}
          title="Settings"
        >
          <Icon name="settings" size={13} strokeWidth={1.9} />
          Settings
        </Link>
      </nav>

      {/* Mobile slide-out drawer */}
      {mobileOpen && (
        <div className="mm-overlay" onClick={onMobileClose}>
          <div className="mm-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mm-head">
              <span className="serif mm-title">{displayName ? `${displayName}'s Portfolio` : "Portfolio"}</span>
              <button className="refresh" onClick={onMobileClose} title="Close">
                <Icon name="x" size={16} />
              </button>
            </div>

            <nav className="mm-nav">
              {TABS.map(({ label, href, icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={"mm-link" + (pathname === href ? " active" : "")}
                  onClick={onMobileClose}
                >
                  <Icon name={icon} size={16} strokeWidth={1.7} />
                  {label}
                </Link>
              ))}
              <Link
                href="/settings"
                className={"mm-link" + (pathname === "/settings" ? " active" : "")}
                onClick={onMobileClose}
              >
                <Icon name="settings" size={16} strokeWidth={1.7} />
                Settings
              </Link>
            </nav>

            <div className="mm-foot">
              <button className="mm-action" onClick={handleRefresh}>
                <Icon name="refresh" size={15} />
                Refresh prices
              </button>
              {onTweaksToggle && (
                <button
                  className="mm-action"
                  onClick={() => {
                    onMobileClose?.();
                    onTweaksToggle();
                  }}
                >
                  <Icon name="sliders" size={15} />
                  Appearance
                </button>
              )}
              <button className="mm-action mm-action-logout" onClick={handleLogout}>
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
