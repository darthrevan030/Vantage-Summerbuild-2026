"use client";

import { useState } from "react";

/**
 * App-styled hover tooltip for inline info markers — replaces the browser's
 * native `title` box so disclosures match the rest of the UI. Resets the
 * inherited heading typography (weight/case/tracking) so body text reads cleanly.
 */
export function InfoTip({
  text,
  label = "ⓘ",
  width = 224,
}: {
  text: string;
  label?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="cursor-help text-[11px] text-muted transition-colors duration-150 hover:text-secondary">
        {label}
      </span>
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-[calc(100%+7px)] z-50 -translate-x-1/2 rounded-lg border border-gold-soft bg-base px-3 py-2 font-ui text-[11px] font-normal normal-case leading-snug tracking-normal text-secondary shadow-[0_8px_28px_rgba(0,0,0,.5)] light:bg-surface light:shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
          style={{ width }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
