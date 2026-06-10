"use client";

import { Toaster } from "sonner";
import { Icon } from "@/components/Icon";

/* Sonner themed via the app's CSS variables: the tokens already flip
   with html.light and track the accent picker, so no theme-sync code
   is needed — toasts are correct on landing, login and dashboard. */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      duration={3500}
      gap={10}
      icons={{
        success: <Icon name="check" size={15} className="text-gain" />,
        error: <Icon name="x" size={15} className="text-loss" />,
      }}
      style={
        {
          "--normal-bg": "color-mix(in srgb, var(--bg-elevated) 90%, transparent)",
          "--normal-border": "var(--border-subtle)",
          "--normal-text": "var(--text-primary)",
          "--border-radius": "10px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          /* trailing ! — sonner's [data-sonner-toast][data-styled=true]
             selectors outrank a single utility class */
          toast:
            "backdrop-blur-md font-ui text-[13px] font-medium " +
            "shadow-[0_18px_40px_-24px_rgba(0,0,0,0.8)] " +
            "data-[type=success]:border-gain/30! data-[type=error]:border-loss/30!",
          title: "font-medium",
        },
      }}
    />
  );
}
