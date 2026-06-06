function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexA(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function applyAccent(hex: string): void {
  const root = document.documentElement;
  root.style.setProperty("--gold", hex);
  root.style.setProperty("--gold-dim", hexA(hex, 0.72));
  root.style.setProperty("--border-gold", hexA(hex, 0.34));
  root.style.setProperty("--accent-wash", hexA(hex, 0.10));
  root.style.setProperty("--accent-tint", hexA(hex, 0.16));
  root.style.setProperty("--accent-glow", hexA(hex, 0.22));
}
