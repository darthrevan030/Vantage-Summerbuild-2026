"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { Icon } from "@/components/Icon";

interface SelectProps {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}

export function Select({ value, options, onChange }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const openDrop = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setDropStyle({ top: r.bottom + 4, left: r.left, width: r.width });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !dropRef.current?.contains(t))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        className={
          "flex w-full cursor-pointer items-center justify-between gap-2 rounded-[9px] border bg-elevated px-3 py-2.5 text-left font-ui text-[13px] text-primary transition-[border-color,box-shadow] duration-150 " +
          (open
            ? "border-gold-soft shadow-[0_0_0_3px_var(--accent-tint)]"
            : "border-subtle hover:border-muted")
        }
        onClick={() => (open ? setOpen(false) : openDrop())}
      >
        <span className="truncate font-flag text-[13px]">{value}</span>
        <Icon
          name="chevron"
          size={14}
          className="shrink-0 text-muted"
          style={{
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform .15s",
          }}
        />
      </button>
      {open && (
        <div
          ref={dropRef}
          className="fixed z-[9999] max-h-60 overflow-y-auto rounded-[10px] border border-subtle bg-surface p-1 shadow-[0_8px_32px_rgba(0,0,0,0.45),0_0_0_1px_rgba(186,170,255,0.08)]"
          style={dropStyle}
        >
          {options.map((o) => (
            <button
              key={o}
              type="button"
              className={
                "block w-full cursor-pointer whitespace-nowrap rounded-[7px] px-[11px] py-2 text-left font-flag text-[13px] transition-[background,color] duration-100 hover:bg-elevated hover:text-primary " +
                (o === value ? "text-gold" : "text-secondary")
              }
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
