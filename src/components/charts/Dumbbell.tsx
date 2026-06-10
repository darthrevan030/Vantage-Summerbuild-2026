"use client";

interface DumbbellProps {
  asset: number;
  fx: number;
  scale: number;
}

export function Dumbbell({ asset, fx, scale }: DumbbellProps) {
  const total = asset + fx;
  const px = (v: number) => (v / scale) * 50;
  const assetEnd = px(asset);
  const totalEnd = px(total);
  const fxColor = fx >= 0 ? "var(--fx-positive)" : "var(--fx-negative)";
  const assetColor = asset >= 0 ? "var(--gain)" : "var(--loss)";
  const aLeft = asset >= 0 ? 50 : 50 + assetEnd;
  const aWidth = Math.abs(assetEnd);
  const fxFrom = 50 + Math.min(assetEnd, totalEnd);
  const fxWidth = Math.abs(totalEnd - assetEnd);

  return (
    <div className="relative h-[18px] w-full max-bp380:hidden">
      <div className="absolute inset-x-0 top-2 h-0.5 rounded-[2px] bg-subtle" />
      <div className="absolute inset-y-0.5 left-1/2 w-px bg-muted" />
      <div className="absolute top-[7px] h-1 rounded-[3px]" style={{ left: aLeft + "%", width: aWidth + "%", background: assetColor }} />
      <div className="absolute top-1 h-2.5 rounded-[3px] opacity-95" style={{ left: fxFrom + "%", width: fxWidth + "%", background: fxColor }} />
      <div className="absolute top-[3px] h-3 w-0 -translate-x-px border-l-2" style={{ left: (50 + totalEnd) + "%", borderColor: total >= 0 ? assetColor : "var(--loss)" }} />
    </div>
  );
}
