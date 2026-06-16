"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Icon } from "@/components/Icon";

interface SelectProps {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}

// Lists longer than this get an inline search box.
const SEARCH_THRESHOLD = 6;

export function Select({ value, options, onChange }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const showSearch = options.length > SEARCH_THRESHOLD;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" ? options : options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  //fix dropdown
  const [openUp, setOpenUp] = useState(false);
  const [maxHeight, setMaxHeight] = useState(300);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const shouldOpenUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const mh = Math.max(
      140,
      Math.min(300, (shouldOpenUp ? spaceAbove : spaceBelow) - 12),
    );
    setOpenUp(shouldOpenUp);
    setMaxHeight(mh);
  }, []);

  const dropStyle: React.CSSProperties = openUp
    ? { bottom: "100%", marginBottom: 4, maxHeight }
    : { top: "100%", marginTop: 4, maxHeight };

  const openDrop = useCallback(() => {
    setQuery("");
    place();
    setOpen(true);
  }, [place]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !dropRef.current?.contains(t))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [open]);

  // Focus the search box when a searchable dropdown opens.
  useEffect(() => {
    if (open && showSearch) searchRef.current?.focus();
  }, [open, showSearch]);

  const choose = (o: string) => {
    onChange(o);
    setOpen(false);
  };

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
          className="absolute left-0 z-[9999] flex w-full flex-col rounded-[10px] border border-subtle bg-surface p-1 shadow-[0_8px_32px_rgba(0,0,0,0.45),0_0_0_1px_rgba(186,170,255,0.08)]"
          style={dropStyle}
        >
          {showSearch && (
            <div className="shrink-0 p-1">
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder="Search…"
                className="w-full rounded-[7px] border border-subtle bg-elevated px-[10px] py-1.5 font-ui text-[12.5px] text-primary outline-none transition-[border-color] duration-150 placeholder:text-muted focus:border-gold-soft"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "Enter" && filtered.length > 0) {
                    e.preventDefault();
                    choose(filtered[0]);
                  }
                }}
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-[11px] py-3 text-center font-ui text-[12.5px] text-muted">
                No matches
              </div>
            ) : (
              filtered.map((o) => (
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
                  onClick={() => choose(o)}
                >
                  {o}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}