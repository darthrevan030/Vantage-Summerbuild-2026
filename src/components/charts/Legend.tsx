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
}

export function Legend({ data, highlight = -1, onItem, showPct = true }: LegendProps) {
  return (
    <div className="legend">
      {data.map((d, i) => (
        <button
          key={i}
          className="legend-item"
          onClick={onItem ? () => onItem(i) : undefined}
          style={{ opacity: highlight >= 0 && highlight !== i ? 0.4 : 1, cursor: onItem ? "pointer" : "default" }}
        >
          <i style={{ background: d.color }} />
          <span className="ui">{d.label}</span>
          {showPct && <span className="mono lg-pct">{d.value}%</span>}
        </button>
      ))}
    </div>
  );
}
