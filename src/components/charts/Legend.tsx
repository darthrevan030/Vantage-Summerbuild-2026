"use client";

interface Slice {
  label: string;
  value: number;
  color: string;
}

interface LegendProps {
  data: Slice[];
  highlight?: number;
  onItem?: (i: number) => void;
  showPct?: boolean;
  /** wrap = sidebar (default); column / rowCenter = inside a donut block */
  layout?: "wrap" | "column" | "rowCenter";
}

const LAYOUTS = {
  wrap: "flex flex-wrap gap-x-3.5 gap-y-[7px]",
  column:
    "flex flex-1 flex-col gap-[9px] max-bp600:flex-none max-bp600:flex-row max-bp600:flex-wrap max-bp600:justify-center",
  rowCenter: "flex flex-row flex-wrap justify-center gap-x-3.5 gap-y-[7px]",
};

export function Legend({ data, highlight = -1, onItem, showPct = true, layout = "wrap" }: LegendProps) {
  return (
    <div className={LAYOUTS[layout]}>
      {data.map((d, i) => (
        <button
          key={i}
          className="flex items-center gap-[7px] border-none bg-transparent p-0 font-ui text-xs text-secondary transition-opacity duration-200"
          onClick={onItem ? () => onItem(i) : undefined}
          style={{ opacity: highlight >= 0 && highlight !== i ? 0.4 : 1, cursor: onItem ? "pointer" : "default" }}
        >
          <i className="size-[9px] shrink-0 rounded-[2px]" style={{ background: d.color }} />
          <span className="font-ui">{d.label}</span>
          {showPct && <span className="ml-auto font-mono text-[11px] text-muted">{d.value}%</span>}
        </button>
      ))}
    </div>
  );
}
