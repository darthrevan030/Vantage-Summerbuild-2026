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
    <div className="dumbbell">
      <div className="db-axis" />
      <div className="db-zero" />
      <div className="db-seg" style={{ left: aLeft + "%", width: aWidth + "%", background: assetColor }} />
      <div className="db-fx" style={{ left: fxFrom + "%", width: fxWidth + "%", background: fxColor }} />
      <div className="db-tip" style={{ left: (50 + totalEnd) + "%", borderColor: total >= 0 ? assetColor : "var(--loss)" }} />
    </div>
  );
}
