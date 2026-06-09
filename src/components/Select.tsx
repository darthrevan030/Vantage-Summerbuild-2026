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
  const dropRef    = useRef<HTMLDivElement>(null);

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
      if (!triggerRef.current?.contains(t) && !dropRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="cselect">
      <button
        ref={triggerRef}
        type="button"
        className={"cselect-trigger" + (open ? " open" : "")}
        onClick={() => (open ? setOpen(false) : openDrop())}
      >
        <span className="cselect-val">{value}</span>
        <Icon
          name="chevron"
          size={14}
          style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s", flexShrink: 0 }}
        />
      </button>
      {open && (
        <div ref={dropRef} className="cselect-drop" style={dropStyle}>
          {options.map((o) => (
            <button
              key={o}
              type="button"
              className={"cselect-opt" + (o === value ? " sel" : "")}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onClick={() => { onChange(o); setOpen(false); }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
