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
  size?: "sm" | "md";
  /** wrap = sidebar (default); column / rowCenter = inside a donut block */
  layout?: "wrap" | "column" | "rowCenter";
}

const LAYOUTS = {
  wrap: "flex flex-wrap gap-x-3.5 gap-y-[7px]",
  column:
    "flex flex-1 flex-col gap-[9px] max-bp600:flex-none max-bp600:flex-row max-bp600:flex-wrap max-bp600:justify-center",
  rowCenter: "flex flex-row flex-wrap justify-center gap-x-3.5 gap-y-[7px]",
};

export function Legend({
  data,
  highlight = -1,
  onItem,
  showPct = true,
  size = "md",
  layout = "wrap",
}: LegendProps) {
  const textCls = size === "sm" ? "text-[10px]" : "text-xs";
  const pctCls  = size === "sm" ? "text-[10px]" : "text-[11px]";
  const dotCls  = size === "sm" ? "size-[7px]"  : "size-[9px]";
  const gapCls  = size === "sm" ? "gap-[5px]"   : "gap-[7px]";
  return (
    <div className={LAYOUTS[layout]}>
      {data.map((d, i) => (
        <button
          key={i}
          className={`flex items-center ${gapCls} border-none bg-transparent p-0 font-ui ${textCls} text-secondary transition-opacity duration-200`}
          onClick={onItem ? () => onItem(i) : undefined}
          style={{
            opacity: highlight >= 0 && highlight !== i ? 0.4 : 1,
            cursor: onItem ? "pointer" : "default",
          }}
        >
          <i
            className={`${dotCls} shrink-0 rounded-[2px]`}
            style={{ background: d.color }}
          />
          <span className="font-ui">{d.label}</span>
          {showPct && (
            <span className={`ml-auto font-mono ${pctCls} text-muted`}>
              {d.value}%
            </span>
          )}
        </button>
      ))}
    </div>
  );
}