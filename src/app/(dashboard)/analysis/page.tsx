"use client";

import { useState, useEffect, useRef } from "react";
import { usePortfolio } from "@/context/portfolio";
import { Icon } from "@/components/Icon";
import { streamSentiment, streamAsk } from "@/lib/api/client/analyst-api";
import { pct } from "@/lib/formatters";
import type { HoldingRow } from "@/types/holding";

// shared gold button — matches the converted settings page pattern
const BTN_GOLD =
  "flex items-center justify-center gap-2 cursor-pointer rounded-[10px] bg-gold p-[13px] mt-1 font-ui text-[13.5px] font-semibold text-[#15130c] [transition:filter_.15s,transform_.1s] hover:brightness-[1.08] active:translate-y-px disabled:opacity-60 disabled:saturate-[.7] disabled:cursor-default";

// ---- score helpers ----
const labelFor = (s: number) => (s >= 25 ? "Bullish" : s <= -25 ? "Bearish" : "Neutral");
const clsFor   = (s: number) => (s >= 25 ? "bull"   : s <= -25 ? "bear"    : "neut");
const toneFor  = (s: number) => (s >= 25 ? "var(--gain)" : s <= -25 ? "var(--loss)" : "var(--gold)");
const clamp    = (n: number) => Math.max(-100, Math.min(100, Math.round(Number(n) || 0)));
const mean     = (a: number[]) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0;

// sentiment pill variants — full utility strings swapped as a unit
const PILL_CLS: Record<string, string> = {
  bull: "bg-[rgba(70,216,160,.14)] text-gain",
  bear: "bg-[rgba(255,111,139,.14)] text-loss",
  neut: "bg-wash text-gold",
};

// headline sentiment dot variants — full utility strings swapped as a unit
const HL_DOT_CLS: Record<string, string> = {
  pos: "bg-gain shadow-[0_0_7px_rgba(70,216,160,.5)]",
  neg: "bg-loss shadow-[0_0_7px_rgba(255,111,139,.5)]",
  neu: "bg-muted",
};

// ---- curated fallback data (demo only — shown when the AI call fails) ----
const FALLBACK_ITEMS: Record<string, { score: number; summary: string; drivers: string[] }> = {
  AAPL:   { score: 62, summary: "Resilient iPhone demand and double-digit services growth; the AI roadmap and steady buybacks support the multiple.", drivers: ["Services margin", "AI roadmap", "Buybacks"] },
  CICT:   { score: 16, summary: "Singapore retail and office occupancy stays firm; rate cuts would help, but new office supply caps the upside.", drivers: ["Rate cuts", "High occupancy", "Office supply"] },
  IWDA:   { score: 47, summary: "Broad developed-market exposure rides the global rally, though heavy US mega-cap weighting concentrates the risk.", drivers: ["Global rally", "US mega-caps", "Low cost"] },
  ASML:   { score: 58, summary: "Semicon equipment demand driven by AI investment cycle; US export controls are the main risk.", drivers: ["AI capex", "Export controls", "Monopoly"] },
  FMG:    { score: 22, summary: "Iron ore demand uncertain as China stimulus expectations fade; strong yield and low debt partially offset.", drivers: ["China demand", "Dividend", "Ore price"] },
};
const FALLBACK_OVERALL = { score: 0, note: "AI Analysis Currently Unavailable" };

// deterministic 12-pt sentiment path ending at `score`
function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function sentPath(id: string, score: number) {
  let seed = hashStr(id);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const n = 12, start = score - 24 + rnd() * 16;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = start * (1 - t) + score * t;
    pts.push(Math.max(-100, Math.min(100, Math.round(base + (rnd() - 0.5) * 20))));
  }
  pts[n - 1] = score;
  return pts;
}

// ---- spark → sentiment path utilities ----
function sampleTo(arr: number[], n: number): number[] {
  if (!arr.length) return [];
  if (arr.length <= n) return arr;
  return Array.from({ length: n }, (_, i) =>
    arr[Math.round((i / (n - 1)) * (arr.length - 1))]
  );
}

function sparkToSentPath(spark: number[]): number[] {
  if (spark.length < 2) return [];
  const pts = sampleTo(spark, 12);
  const min = Math.min(...pts), max = Math.max(...pts), rng = max - min || 1;
  return pts.map(v => Math.round(((v - min) / rng) * 200 - 100));
}

function priceDelta(spark: number[]): number | null {
  if (spark.length < 2) return null;
  const first = spark[0];
  return first === 0 ? null : ((spark[spark.length - 1] - first) / first) * 100;
}

// ---- MiniSpark (inline sentiment trend) ----
function MiniSpark({ pts, color, height = 44 }: { pts: number[]; color: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(260);
  const idRef = useRef("ms" + Math.round(Math.random() * 1e9));
  useEffect(() => {
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const min = Math.min(...pts), max = Math.max(...pts), rng = (max - min) || 1;
  const step = w / (pts.length - 1);
  const Y = (v: number) => height - 4 - ((v - min) / rng) * (height - 8);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;
  const id = idRef.current;
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={w} height={height} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={w} cy={Y(pts[pts.length - 1])} r="2.4" fill={color} />
      </svg>
    </div>
  );
}

// ---- ScoreRail ----
function ScoreRail({ score }: { score: number }) {
  const w    = (Math.abs(score) / 100) * 50;
  const left = score >= 0 ? 50 : 50 - w;
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 h-2.5 rounded-md bg-elevated">
        <div className="absolute left-1/2 top-[-3px] bottom-[-3px] w-px bg-muted opacity-[.45]" />
        <div className="absolute top-0 bottom-0 rounded-md [transition:width_.6s_cubic-bezier(.2,.7,.2,1),left_.6s_cubic-bezier(.2,.7,.2,1)]" style={{ left: left + "%", width: w + "%", background: toneFor(score) }} />
      </div>
      <span className="font-mono text-[13px] font-semibold min-w-[38px] text-right" style={{ color: toneFor(score) }}>{score > 0 ? "+" : ""}{score}</span>
    </div>
  );
}

// ---- SentDrawer (headlines + 30-day trend) ----
type HlItem = { t: string; src: string; sent: string; ago: string };
type HlState = HlItem[] | "loading" | "no-key" | "empty";

const HL_CACHE: Record<string, HlItem[]> = {};

function SentDrawer({ id, name, score, sparkData }: { id: string; name: string; assetType: string; score: number; sparkData: number[] }) {
  const [hl, setHl] = useState<HlState>(HL_CACHE[id] ?? "loading");
  const useRealPrices = sparkData.length >= 2;
  const pts   = useRealPrices ? sparkToSentPath(sparkData) : sentPath(id, score);
  const delta = useRealPrices ? (priceDelta(sparkData) ?? 0) : pts[pts.length - 1] - pts[0];

  useEffect(() => {
    if (HL_CACHE[id]) { setHl(HL_CACHE[id]); return; }
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/news?symbol=${encodeURIComponent(id)}`);
        const data = await res.json();
        // API returned no-key sentinel
        if (data && !Array.isArray(data) && data.noKey) {
          if (live) setHl("no-key");
          return;
        }
        const items: HlItem[] = Array.isArray(data) ? data.filter((n: HlItem) => n.t) : [];
        HL_CACHE[id] = items;
        if (live) setHl(items.length > 0 ? items : "empty");
      } catch {
        if (live) setHl("empty");
      }
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="flex flex-col gap-[13px] pt-[3px] [animation:fadeSlideUp_.3s_ease_both]">
      <div className="flex flex-col gap-[5px] bg-elevated border border-subtle rounded-[11px] px-[13px] py-[11px]">
        <div className="flex items-center justify-between">
          <span className="font-ui text-secondary text-[11px] tracking-[.04em]">{useRealPrices ? "30-day price" : "30-day sentiment"}</span>
          <span className="font-mono text-[11px] tracking-[.04em]" style={{ color: delta >= 0 ? "var(--gain)" : "var(--loss)" }}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))}{useRealPrices ? "%" : " pts"}
          </span>
        </div>
        <MiniSpark pts={pts} color={toneFor(score)} />
      </div>
      <div className="flex flex-col">
        {hl === "loading" && [0, 1, 2].map((i) => (
          <div className="flex gap-[11px] items-start py-[9px] border-t border-subtle first:border-t-0 first:pt-0.5" key={i}>
            <div className="bg-elevated rounded-lg animate-skeleton" style={{ width: 7, height: 7, borderRadius: "50%", marginTop: 5 }} />
            <div className="flex flex-col gap-0.5 min-w-0" style={{ flex: 1, gap: 6 }}>
              <div className="bg-elevated rounded-lg animate-skeleton" style={{ height: 11, width: "88%" }} />
              <div className="bg-elevated rounded-lg animate-skeleton" style={{ height: 9, width: 70 }} />
            </div>
          </div>
        ))}
        {hl === "no-key" && (
          <div className="text-xs text-muted py-2.5 font-ui">No <code className="font-mono text-[11px] text-secondary">FINNHUB_API_KEY</code> — set it to load live headlines for {name}.</div>
        )}
        {hl === "empty" && (
          <div className="text-xs text-muted py-2.5 font-ui">No recent headlines found for {name}.</div>
        )}
        {Array.isArray(hl) && hl.map((h, i) => (
          <div className="flex gap-[11px] items-start py-[9px] border-t border-subtle first:border-t-0 first:pt-0.5" key={i}>
            <i className={"w-[7px] h-[7px] rounded-full mt-[5px] flex-[0_0_auto] " + (HL_DOT_CLS[h.sent] ?? "")} />
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="text-[12.5px] text-primary leading-[1.4] [text-wrap:pretty]">{h.t}</div>
              <div className="text-[11px] text-muted font-mono tracking-[.02em]">{h.src} · {h.ago}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- SentCard ----
interface SentItem { id: string; name: string; icon: string; assetType: string; ticker: string; score: number; summary: string; drivers: string[]; sparkData: number[] }

function SentCard({ it, delay }: { it: SentItem; delay: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card flex flex-col gap-[13px] px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3 animate-reveal" style={{ animationDelay: delay + "s" }}>
      <div className="flex items-center gap-[11px]">
        <div className="w-7 h-7 rounded-[7px] bg-elevated border border-subtle grid place-items-center text-gold flex-[0_0_auto]"><Icon name={it.icon as never} size={15} /></div>
        <div className="flex flex-col gap-px min-w-0 flex-1">
          <span className="font-ui text-[14px] font-semibold text-primary whitespace-nowrap overflow-hidden text-ellipsis">{it.name}</span>
          <span className="font-mono text-[10.5px] text-muted tracking-[.05em]">{it.ticker.replace(/_\d+$/, "")}</span>
        </div>
        <span className={"font-ui text-[11px] font-semibold px-[11px] py-1 rounded-full whitespace-nowrap tracking-[.02em] " + (PILL_CLS[clsFor(it.score)] ?? "")}>{labelFor(it.score)}</span>
      </div>
      <ScoreRail score={it.score} />
      <div className="text-[12.8px] leading-[1.55] text-secondary">{it.summary}</div>
      {it.drivers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {it.drivers.map((d, i) => <span className="font-ui text-[11px] text-secondary bg-elevated border border-subtle rounded-[7px] px-[9px] py-1" key={i}>{d}</span>)}
        </div>
      )}
      <button className="mt-px flex items-center justify-center gap-1.5 w-full bg-transparent border-t border-subtle pt-[11px] pb-px px-0 text-secondary font-ui text-xs cursor-pointer transition-colors duration-150 hover:text-gold" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide detail" : "Headlines & 30-day trend"}
        <Icon name="chevron" size={14} className={open ? "rotate-180 transition-transform duration-[250ms]" : "transition-transform duration-[250ms]"} />
      </button>
      {open && <SentDrawer id={it.id} name={it.name} assetType={it.assetType} score={it.score} sparkData={it.sparkData} />}
    </div>
  );
}

function SkelCard({ delay }: { delay: number }) {
  return (
    <div className="card flex flex-col gap-[13px] px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3 animate-reveal" style={{ animationDelay: delay + "s" }}>
      <div className="flex items-center gap-[11px]">
        <div className="bg-elevated rounded-lg animate-skeleton" style={{ width: 28, height: 28, borderRadius: 7 }} />
        <div className="flex flex-col gap-px min-w-0 flex-1" style={{ gap: 6 }}>
          <div className="bg-elevated rounded-lg animate-skeleton" style={{ width: 130, height: 12 }} />
          <div className="bg-elevated rounded-lg animate-skeleton" style={{ width: 50, height: 9 }} />
        </div>
        <div className="bg-elevated rounded-lg animate-skeleton" style={{ width: 66, height: 22, borderRadius: 999 }} />
      </div>
      <div className="bg-elevated rounded-lg animate-skeleton" style={{ height: 10, borderRadius: 6 }} />
      <div className="bg-elevated rounded-lg animate-skeleton" style={{ height: 34 }} />
      <div className="flex flex-wrap gap-1.5">
        {[44, 60, 50].map((w, i) => <div className="bg-elevated rounded-lg animate-skeleton" key={i} style={{ width: w, height: 22, borderRadius: 7 }} />)}
      </div>
    </div>
  );
}

// ---- Aggregate hero ----
function Hero({ overall, items }: { overall: { score: number; note: string }; items: SentItem[] }) {
  const counts = { bull: 0, neut: 0, bear: 0 };
  items.forEach((i) => { (counts[clsFor(i.score) as "bull" | "neut" | "bear"])++; });
  const mark = ((overall.score + 100) / 200) * 100;
  return (
    <div className="card relative grid grid-cols-[minmax(180px,250px)_1fr] gap-[34px] items-center overflow-hidden px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3 max-bp1080:grid-cols-[1fr] max-bp1080:gap-[22px] before:content-[''] before:absolute before:inset-0 before:bg-[radial-gradient(70%_130%_at_14%_18%,var(--accent-glow)_0%,transparent_58%)] before:opacity-60 before:pointer-events-none animate-reveal">
      <div className="relative flex flex-col gap-1">
        <span className="font-ui text-secondary text-[11px] tracking-[.04em]">Portfolio sentiment</span>
        <span className="font-serif font-normal text-[38px] leading-none tracking-[.3px] max-bp768:text-[32px]" style={{ color: toneFor(overall.score) }}>{labelFor(overall.score)}</span>
        <span className="font-mono text-[14px] font-semibold" style={{ color: toneFor(overall.score) }}>
          {overall.score > 0 ? "+" : ""}{overall.score} <span className="text-secondary">/ 100</span>
        </span>
        <span className="text-[12.5px] text-secondary mt-1.5 max-w-[240px]">{overall.note}</span>
      </div>
      <div className="relative flex flex-col gap-3.5">
        <div className="relative h-3 rounded-lg bg-[linear-gradient(90deg,var(--loss)_0%,#6c6786_50%,var(--gain)_100%)] opacity-[.92]"><div className="absolute top-[-5px] w-1 h-[22px] rounded-[3px] bg-primary shadow-[0_0_12px_var(--accent-glow),0_2px_6px_rgba(0,0,0,.5)] [transition:left_.7s_cubic-bezier(.2,.7,.2,1)]" style={{ left: `calc(${mark}% - 2px)` }} /></div>
        <div className="flex justify-between text-[10.5px] text-muted font-mono mt-[-4px]"><span>Bearish</span><span>Neutral</span><span>Bullish</span></div>
        <div className="flex gap-[18px]">
          <span className="flex items-center gap-[7px] text-[12.5px] text-secondary"><i className="w-[9px] h-[9px] rounded-[3px]" style={{ background: "var(--gain)" }} /><b className="text-primary font-semibold tabular-nums">{counts.bull}</b> Bullish</span>
          <span className="flex items-center gap-[7px] text-[12.5px] text-secondary"><i className="w-[9px] h-[9px] rounded-[3px]" style={{ background: "var(--gold)" }} /><b className="text-primary font-semibold tabular-nums">{counts.neut}</b> Neutral</span>
          <span className="flex items-center gap-[7px] text-[12.5px] text-secondary"><i className="w-[9px] h-[9px] rounded-[3px]" style={{ background: "var(--loss)" }} /><b className="text-primary font-semibold tabular-nums">{counts.bear}</b> Bearish</span>
        </div>
      </div>
    </div>
  );
}

// ---- Ask box ----
const SUGGEST = ["What is my biggest risk?", "Summarise my book in two lines", "Which holding looks most fragile?"];

function AskBox({ holdings }: { holdings: HoldingRow[] }) {
  const [q, setQ]         = useState("");
  const [ans, setAns]     = useState("");
  const [phase, setPhase] = useState<"idle" | "thinking" | "typing" | "done">("idle");
  const abortRef          = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = async (text?: string) => {
    const query = (text ?? q).trim();
    if (!query || phase === "thinking" || phase === "typing") return;
    if (text) setQ(text);
    setPhase("thinking"); setAns("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const askHoldings = holdings.map((h) => ({ name: h.name, assetType: h.assetType, totalPct: h.totalPct }));
    const totalSGD = holdings.reduce((s, h) => s + h.valueSGD, 0);

    try {
      let first = true;
      const { text: full, stopReason } = await streamAsk(
        query,
        askHoldings,
        totalSGD,
        (chunk) => {
          if (first) { setPhase("typing"); first = false; }
          setAns((prev) => prev + chunk);
        },
        abortRef.current.signal
      );
      if (!full.trim()) setAns("No response received.");
      if (stopReason === "max_tokens") setAns((prev) => prev + " …");
      setPhase("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // superseded by a newer ask
      setAns("The analysis engine is offline in this preview. Once connected, this answers questions about your book in plain language.");
      setPhase("done");
    }
  };

  return (
    <div className="card flex flex-col gap-3 px-5 py-4.5 max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3">
      <div className="flex items-baseline justify-between mb-4 max-bp600:flex-wrap max-bp600:gap-2 max-bp600:items-center">
        <span className="text-[13px] font-semibold text-primary tracking-[.01em]">Ask the analyst</span>
        <span className="font-ui text-secondary text-[11px]">AI · plain language</span>
      </div>
      <div className="flex gap-2.5">
        <input
          className="inp flex-1"
          placeholder="Ask anything about your portfolio…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
        />
        <button
          className={BTN_GOLD}
          style={{ margin: 0, padding: "11px 20px", gridColumn: "auto" }}
          disabled={phase === "thinking" || phase === "typing"}
          onClick={() => ask()}
        >
          {phase === "thinking" || phase === "typing" ? "Thinking…" : "Ask"}
        </button>
      </div>
      <div className="flex gap-2 flex-wrap">
        {SUGGEST.map((s) => (
          <button className="font-ui text-xs text-secondary bg-elevated border border-subtle rounded-lg px-3 py-[7px] cursor-pointer transition-all duration-150 hover:text-gold hover:border-gold-soft" key={s} onClick={() => ask(s)}>{s}</button>
        ))}
      </div>
      {phase === "thinking" && (
        <div className="text-[13.5px] leading-[1.6] text-primary border-l-2 border-gold-soft pl-4 py-1 [animation:fadeSlideUp_.4s_ease_both]">Reading your book<span className="inline-block w-[7px] h-[15px] bg-gold ml-0.5 align-[-2px] animate-blink" /></div>
      )}
      {(phase === "typing" || phase === "done") && (
        <div className="text-[13.5px] leading-[1.6] text-primary border-l-2 border-gold-soft pl-4 py-1 [animation:fadeSlideUp_.4s_ease_both]">
          {ans}{phase === "typing" && <span className="inline-block w-[7px] h-[15px] bg-gold ml-0.5 align-[-2px] animate-blink" />}
        </div>
      )}
    </div>
  );
}

// ---- main page ----
interface AnalysisData {
  items: SentItem[];
  overall: { score: number; note: string };
  source: "ai" | "sample";
}

// cache keyed on a holdings fingerprint — invalidates when the portfolio changes
let SENT_CACHE: { key: string; data: AnalysisData } | null = null;

const holdingsKey = (holdings: HoldingRow[]) =>
  holdings.map((h) => `${h.ticker}:${h.sparkData.at(-1) ?? 0}`).join("|");

function buildFallback(holdings: HoldingRow[]): AnalysisData {
  const items = holdings.map((h, i) => {
    const id  = h.ticker !== "—" ? h.ticker : (h.assetType + "_" + i);
    const fb  = FALLBACK_ITEMS[id] ?? { score: 0, summary: `${h.name} — no live analysis yet.`, drivers: [] };
    return { id, name: h.name, icon: h.icon, assetType: h.assetType, ticker: id, sparkData: h.sparkData, ...fb };
  });
  return { items, overall: FALLBACK_OVERALL, source: "sample" };
}

async function runSentimentAI(holdings: HoldingRow[]): Promise<AnalysisData> {
  const assets = holdings.map((h, i) => ({
    id:        h.ticker !== "—" ? h.ticker : (h.assetType + "_" + i),
    name:      h.name,
    type:      h.assetType,
    icon:      h.icon,
    sparkData: h.sparkData,
    delta:     priceDelta(h.sparkData),
  }));

  const { text, stopReason } = await streamSentiment(
    assets.map(({ id, name, type, delta }) => ({ id, name, type, delta }))
  );

  if (stopReason === "max_tokens") {
    // Truncated JSON won't parse — fail loudly so the caller falls back
    // and the reason is visible in the console instead of a silent swap.
    throw new Error("sentiment response truncated (max_tokens)");
  }

  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a === -1 || b <= a) throw new Error("no JSON in sentiment response");
  const json = JSON.parse(text.slice(a, b + 1));

  const byId: Record<string, { score: number; summary: string; drivers: string[] }> = {};
  (json.items || []).forEach((x: { id: string; score: number; summary: string; drivers: string[] }) => { byId[String(x.id)] = x; });

  const items = assets.map((as) => {
    const f = byId[as.id] ?? FALLBACK_ITEMS[as.id] ?? {};
    return { ...as, assetType: as.type, ticker: as.id, sparkData: as.sparkData, score: clamp((f as { score?: number }).score ?? 0), summary: (f as { summary?: string }).summary ?? "", drivers: ((f as { drivers?: string[] }).drivers ?? []).slice(0, 3) };
  });

  const ovScore = json.overall?.score != null ? clamp(json.overall.score) : mean(items.map((i) => i.score));
  return { items, overall: { score: ovScore, note: json.overall?.note ?? FALLBACK_OVERALL.note }, source: "ai" };
}

export default function AnalysisPage() {
  const { holdings } = usePortfolio();
  const key = holdingsKey(holdings);
  const cached = SENT_CACHE?.key === key ? SENT_CACHE.data : null;

  // Show fallback data immediately — AI runs in background and upgrades the state
  const [data, setData]           = useState<AnalysisData>(() => cached ?? buildFallback(holdings));
  const [aiRunning, setAiRunning] = useState(!cached);

  const run = async () => {
    setAiRunning(true);
    let res: AnalysisData;
    try { res = await runSentimentAI(holdings); }
    catch (err) { console.warn("sentiment AI failed, using sample data:", err); res = buildFallback(holdings); }
    SENT_CACHE = { key, data: res }; setData(res); setAiRunning(false);
  };

  useEffect(() => {
    if (cached) return;
    let live = true;
    (async () => {
      let res: AnalysisData;
      try { res = await runSentimentAI(holdings); }
      catch (err) { console.warn("sentiment AI failed, using sample data:", err); res = buildFallback(holdings); }
      if (live) { SENT_CACHE = { key, data: res }; setData(res); setAiRunning(false); }
    })();
    return () => { live = false; };
  // re-run when the portfolio fingerprint changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const left  = data.items.filter((_, i) => i % 2 === 0);
  const right = data.items.filter((_, i) => i % 2 === 1);

  return (
    <div className="flex flex-col gap-[18px] min-w-0 w-full">
      <div className="flex items-end justify-between gap-[18px] flex-wrap mb-0.5 animate-reveal">
        <div>
          <div className="text-[10.5px] uppercase tracking-[.14em] text-gold font-semibold">AI Analysis</div>
          <h2 className="font-serif font-normal text-[26px] mt-1.5 mb-1 tracking-[.2px]">Market sentiment</h2>
          <div className="text-[13px] text-secondary max-w-[440px]">An AI read on every holding — direction, conviction, and the drivers moving each position.</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-[7px] text-[11px] text-secondary">
            <i className="w-1.5 h-1.5 rounded-full bg-gold shadow-[0_0_8px_var(--accent-glow)]" />
            {aiRunning ? "Analysing…" : data.source === "ai" ? "Updated just now" : "Sample data"}
          </span>
          <button
            className={BTN_GOLD}
            style={{ margin: 0, padding: "11px 18px", gridColumn: "auto" }}
            disabled={aiRunning}
            onClick={run}
          >
            <Icon name="refresh" size={15} />{aiRunning ? "Running…" : "Re-run"}
          </button>
        </div>
      </div>

      <Hero overall={data.overall} items={data.items} />
      <AskBox holdings={holdings} />
      <div className="flex gap-[18px] items-start max-bp1080:flex-col max-bp768:w-full">
        <div className="flex-1 flex flex-col gap-[18px] min-w-0">
          {left.map((it, i) => <SentCard key={it.id} it={it} delay={0.05 + i * 0.08} />)}
        </div>
        <div className="flex-1 flex flex-col gap-[18px] min-w-0">
          {right.map((it, i) => <SentCard key={it.id} it={it} delay={0.09 + i * 0.08} />)}
        </div>
      </div>
      {data.source === "sample" && !aiRunning && (
        <div className="text-[11.5px] text-muted flex items-center gap-1.5">
          <Icon name="file" size={13} />
          Showing curated sample data — set a real <code>ANTHROPIC_API_KEY</code> for a live read.
        </div>
      )}
    </div>
  );
}