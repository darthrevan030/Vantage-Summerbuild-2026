"use client";

import { useState, useEffect, useRef } from "react";
import { usePortfolio } from "@/context/portfolio";
import { Icon } from "@/components/Icon";
import { streamAnalysis } from "@/lib/api-client";
import { pct } from "@/lib/formatters";
import type { HoldingRow } from "@/types/holding";

// ---- score helpers ----
const labelFor = (s: number) => (s >= 25 ? "Bullish" : s <= -25 ? "Bearish" : "Neutral");
const clsFor   = (s: number) => (s >= 25 ? "bull"   : s <= -25 ? "bear"    : "neut");
const toneFor  = (s: number) => (s >= 25 ? "var(--gain)" : s <= -25 ? "var(--loss)" : "var(--gold)");
const clamp    = (n: number) => Math.max(-100, Math.min(100, Math.round(Number(n) || 0)));
const mean     = (a: number[]) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0;

// ---- curated fallback data ----
const FALLBACK_ITEMS: Record<string, { score: number; summary: string; drivers: string[] }> = {
  AAPL:   { score: 62, summary: "Resilient iPhone demand and double-digit services growth; the AI roadmap and steady buybacks support the multiple.", drivers: ["Services margin", "AI roadmap", "Buybacks"] },
  CICT:   { score: 16, summary: "Singapore retail and office occupancy stays firm; rate cuts would help, but new office supply caps the upside.", drivers: ["Rate cuts", "High occupancy", "Office supply"] },
  IWDA:   { score: 47, summary: "Broad developed-market exposure rides the global rally, though heavy US mega-cap weighting concentrates the risk.", drivers: ["Global rally", "US mega-caps", "Low cost"] },
  ASML:   { score: 58, summary: "Semicon equipment demand driven by AI investment cycle; US export controls are the main risk.", drivers: ["AI capex", "Export controls", "Monopoly"] },
  FMG:    { score: 22, summary: "Iron ore demand uncertain as China stimulus expectations fade; strong yield and low debt partially offset.", drivers: ["China demand", "Dividend", "Ore price"] },
};
const FALLBACK_OVERALL = { score: 43, note: "Constructive book; rates and FX are the swing factors." };

const FALLBACK_HL: Record<string, { t: string; src: string; sent: string; ago: string }[]> = {
  AAPL:   [{ t: "Services revenue hits record as App Store momentum builds", src: "Bloomberg", sent: "pos", ago: "3h" }, { t: "Analysts trim iPhone unit estimates on China softness", src: "Reuters", sent: "neg", ago: "1d" }, { t: "New on-device AI features roll out across the lineup", src: "The Verge", sent: "pos", ago: "2d" }],
  CICT:   [{ t: "Singapore retail rents edge higher on tourism recovery", src: "Biz Times", sent: "pos", ago: "5h" }, { t: "Office leasing slows as supply pipeline expands", src: "EdgeProp", sent: "neg", ago: "2d" }, { t: "REIT reaffirms full-year distribution guidance", src: "SGX", sent: "neu", ago: "4d" }],
  IWDA:   [{ t: "Developed-market equities extend rally to fresh highs", src: "FT", sent: "pos", ago: "2h" }, { t: "Concentration in US mega-caps raises diversification flags", src: "Morningstar", sent: "neg", ago: "1d" }, { t: "Passive inflows accelerate into global index funds", src: "ETF.com", sent: "pos", ago: "3d" }],
  ASML:   [{ t: "ASML order intake beats estimates on leading-edge demand", src: "Bloomberg", sent: "pos", ago: "4h" }, { t: "US widens chip export controls to more regions", src: "WSJ", sent: "neg", ago: "1d" }, { t: "EUV capacity expansion set for 2026 delivery", src: "Reuters", sent: "pos", ago: "3d" }],
  FMG:    [{ t: "Iron ore dips on weaker-than-expected China PMI", src: "Reuters", sent: "neg", ago: "6h" }, { t: "Fortescue reaffirms green energy investment plan", src: "AFR", sent: "pos", ago: "2d" }, { t: "Dividend yield remains attractive at current price", src: "Morningstar", sent: "neu", ago: "3d" }],
};

function genericHL(h: HoldingRow) {
  return [
    { t: `Sentiment steady for ${h.name} into the week`, src: "Wire", sent: "neu", ago: "1d" },
    { t: `Sector flows turn supportive for ${h.assetType.toLowerCase()}`, src: "Markets", sent: "pos", ago: "2d" },
    { t: "Macro backdrop adds near-term uncertainty", src: "Macro", sent: "neg", ago: "3d" },
  ];
}

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
    <div className="score-wrap">
      <div className="score-rail">
        <div className="score-zero" />
        <div className="score-fill" style={{ left: left + "%", width: w + "%", background: toneFor(score) }} />
      </div>
      <span className="score-num" style={{ color: toneFor(score) }}>{score > 0 ? "+" : ""}{score}</span>
    </div>
  );
}

// ---- SentDrawer (headlines + 30-day trend) ----
const HL_CACHE: Record<string, { t: string; src: string; sent: string; ago: string }[]> = {};

function SentDrawer({ id, name, assetType, score }: { id: string; name: string; assetType: string; score: number }) {
  const [hl, setHl]       = useState<typeof HL_CACHE[string] | null>(HL_CACHE[id] ?? null);
  const [loading, setLoading] = useState(!HL_CACHE[id]);
  const pts   = sentPath(id, score);
  const delta = pts[pts.length - 1] - pts[0];

  useEffect(() => {
    if (HL_CACHE[id]) return;
    let live = true;
    (async () => {
      const fallback = FALLBACK_HL[id] ?? [
        { t: `Sentiment steady for ${name} into the week`, src: "Wire", sent: "neu", ago: "1d" },
        { t: `Sector flows supportive for ${assetType.toLowerCase()}`, src: "Markets", sent: "pos", ago: "2d" },
        { t: "Macro backdrop adds near-term uncertainty", src: "Macro", sent: "neg", ago: "3d" },
      ];
      try {
        const res = await fetch(`/api/news?symbol=${encodeURIComponent(id)}`);
        const items = await res.json();
        HL_CACHE[id] = Array.isArray(items) && items.length >= 1 ? items : fallback;
      } catch {
        HL_CACHE[id] = fallback;
      }
      if (live) { setHl(HL_CACHE[id]); setLoading(false); }
    })();
    return () => { live = false; };
  }, [id]);

  return (
    <div className="sent-drawer">
      <div className="sd-trend">
        <div className="sd-trend-head">
          <span className="ui muted xs">30-day sentiment</span>
          <span className="mono xs" style={{ color: delta >= 0 ? "var(--gain)" : "var(--loss)" }}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pts
          </span>
        </div>
        <MiniSpark pts={pts} color={toneFor(score)} />
      </div>
      <div className="sd-news">
        {loading
          ? [0, 1, 2].map((i) => (
            <div className="hl-row" key={i}>
              <div className="sk" style={{ width: 7, height: 7, borderRadius: "50%", marginTop: 5 }} />
              <div className="hl-body" style={{ flex: 1, gap: 6 }}>
                <div className="sk" style={{ height: 11, width: "88%" }} />
                <div className="sk" style={{ height: 9, width: 70 }} />
              </div>
            </div>
          ))
          : (hl ?? []).map((h, i) => (
            <div className="hl-row" key={i}>
              <i className={"hl-dot " + h.sent} />
              <div className="hl-body">
                <div className="hl-t">{h.t}</div>
                <div className="hl-meta">{h.src} · {h.ago}</div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ---- SentCard ----
interface SentItem { id: string; name: string; icon: string; assetType: string; ticker: string; score: number; summary: string; drivers: string[] }

function SentCard({ it, delay }: { it: SentItem; delay: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"card sent-card reveal" + (open ? " open" : "")} style={{ animationDelay: delay + "s" }}>
      <div className="sent-top">
        <div className="row-ic"><Icon name={it.icon as never} size={15} /></div>
        <div className="sent-id">
          <span className="ui">{it.name}</span>
          <span className="mono ticker">{it.ticker.replace(/_\d+$/, "")}</span>
        </div>
        <span className={"sent-pill " + clsFor(it.score)}>{labelFor(it.score)}</span>
      </div>
      <ScoreRail score={it.score} />
      <div className="sent-sum">{it.summary}</div>
      {it.drivers.length > 0 && (
        <div className="drivers">
          {it.drivers.map((d, i) => <span className="driver" key={i}>{d}</span>)}
        </div>
      )}
      <button className="sent-more" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide detail" : "Headlines & 30-day trend"}
        <Icon name="chevron" size={14} />
      </button>
      {open && <SentDrawer id={it.id} name={it.name} assetType={it.assetType} score={it.score} />}
    </div>
  );
}

function SkelCard({ delay }: { delay: number }) {
  return (
    <div className="card sent-card reveal" style={{ animationDelay: delay + "s" }}>
      <div className="sent-top">
        <div className="sk" style={{ width: 28, height: 28, borderRadius: 7 }} />
        <div className="sent-id" style={{ gap: 6 }}>
          <div className="sk" style={{ width: 130, height: 12 }} />
          <div className="sk" style={{ width: 50, height: 9 }} />
        </div>
        <div className="sk" style={{ width: 66, height: 22, borderRadius: 999 }} />
      </div>
      <div className="sk" style={{ height: 10, borderRadius: 6 }} />
      <div className="sk" style={{ height: 34 }} />
      <div className="drivers">
        {[44, 60, 50].map((w, i) => <div className="sk" key={i} style={{ width: w, height: 22, borderRadius: 7 }} />)}
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
    <div className="card an-hero reveal">
      <div className="anh-left">
        <span className="ui muted xs">Portfolio sentiment</span>
        <span className="anh-label" style={{ color: toneFor(overall.score) }}>{labelFor(overall.score)}</span>
        <span className="anh-score" style={{ color: toneFor(overall.score) }}>
          {overall.score > 0 ? "+" : ""}{overall.score} <span className="muted">/ 100</span>
        </span>
        <span className="anh-note">{overall.note}</span>
      </div>
      <div className="anh-right">
        <div className="meter"><div className="meter-mark" style={{ left: `calc(${mark}% - 2px)` }} /></div>
        <div className="meter-scale"><span>Bearish</span><span>Neutral</span><span>Bullish</span></div>
        <div className="dist">
          <span className="dist-item"><i className="dist-dot" style={{ background: "var(--gain)" }} /><b>{counts.bull}</b> Bullish</span>
          <span className="dist-item"><i className="dist-dot" style={{ background: "var(--gold)" }} /><b>{counts.neut}</b> Neutral</span>
          <span className="dist-item"><i className="dist-dot" style={{ background: "var(--loss)" }} /><b>{counts.bear}</b> Bearish</span>
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
  const timer             = useRef<NodeJS.Timeout | null>(null);
  const abortRef          = useRef<AbortController | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const typewrite = (full: string) => {
    if (timer.current) clearInterval(timer.current);
    let i = 0; setAns(""); setPhase("typing");
    timer.current = setInterval(() => {
      i += 2; setAns(full.slice(0, i));
      if (i >= full.length) { if (timer.current) clearInterval(timer.current); setPhase("done"); }
    }, 14);
  };

  const ask = async (text?: string) => {
    const query = (text ?? q).trim();
    if (!query || phase === "thinking") return;
    if (text) setQ(text);
    setPhase("thinking"); setAns("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const ctx = holdings.map((h) => `${h.name} (${h.assetType}, ${h.totalPct >= 0 ? "+" : ""}${h.totalPct.toFixed(1)}%)`).join("; ");
    const totalSGD = holdings.reduce((s, h) => s + h.valueSGD, 0);
    const prompt =
      `You are a concise portfolio analyst inside a personal wealth terminal. ` +
      `Portfolio: total S$${Math.round(totalSGD).toLocaleString()}, holdings: ${ctx}. ` +
      `This is a design demo — no financial advice or disclaimers.\n\nUser question: "${query}"\n\nAnswer in 2–3 short, specific sentences. Plain text only, no markdown.`;
    let full = "";
    try {
      await streamAnalysis(prompt, (chunk) => { full += chunk; }, abortRef.current.signal);
      typewrite(full.trim() || "No response received.");
    } catch {
      typewrite("The analysis engine is offline in this preview. Once connected, this answers questions about your book in plain language.");
    }
  };

  return (
    <div className="card ask">
      <div className="card-head">
        <span className="card-title">Ask the analyst</span>
        <span className="ui muted">AI · plain language</span>
      </div>
      <div className="ask-row">
        <input
          className="inp"
          placeholder="Ask anything about your portfolio…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
        />
        <button
          className="btn-gold"
          style={{ margin: 0, padding: "11px 20px", gridColumn: "auto" }}
          disabled={phase === "thinking"}
          onClick={() => ask()}
        >
          {phase === "thinking" ? "Thinking…" : "Ask"}
        </button>
      </div>
      <div className="ask-chips">
        {SUGGEST.map((s) => (
          <button className="ask-chip" key={s} onClick={() => ask(s)}>{s}</button>
        ))}
      </div>
      {phase === "thinking" && (
        <div className="ask-answer muted">Reading your book<span className="cursor" /></div>
      )}
      {(phase === "typing" || phase === "done") && (
        <div className="ask-answer">
          {ans}{phase === "typing" && <span className="cursor" />}
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

let SENT_CACHE: AnalysisData | null = null;

function buildFallback(holdings: HoldingRow[]): AnalysisData {
  const items = holdings.map((h, i) => {
    const id  = h.ticker !== "—" ? h.ticker : (h.assetType + "_" + i);
    const fb  = FALLBACK_ITEMS[id] ?? { score: 0, summary: `${h.name} — no analysis available.`, drivers: [] };
    return { id, name: h.name, icon: h.icon, assetType: h.assetType, ticker: id, ...fb };
  });
  return { items, overall: FALLBACK_OVERALL, source: "sample" };
}

async function runSentimentAI(holdings: HoldingRow[]): Promise<AnalysisData> {
  const assets = holdings.map((h, i) => ({
    id:   h.ticker !== "—" ? h.ticker : (h.assetType + "_" + i),
    name: h.name,
    type: h.assetType,
    icon: h.icon,
  }));

  const prompt =
    "You are an equity & macro sentiment analyst inside a personal wealth terminal. Assess current market sentiment for each holding below. This is a design demo — reason from your general knowledge; do NOT claim live data and do NOT give financial advice.\n\n" +
    'Respond with ONLY minified JSON (no markdown, no commentary) in exactly this shape:\n' +
    '{"overall":{"score":INT,"note":"<=13 words"},"items":[{"id":"ID","score":INT,"summary":"<=24 words","drivers":["<=3 words","<=3 words","<=3 words"]}]}\n' +
    "score is an integer from -100 (very bearish) to 100 (very bullish). Echo back each id exactly.\n\nHoldings:\n" +
    assets.map((a) => `- id=${a.id} | ${a.name} | ${a.type}`).join("\n");

  let text = "";
  await streamAnalysis(prompt, (chunk) => { text += chunk; });
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  const json = JSON.parse(text.slice(a, b + 1));
  const byId: Record<string, { score: number; summary: string; drivers: string[] }> = {};
  (json.items || []).forEach((x: { id: string; score: number; summary: string; drivers: string[] }) => { byId[String(x.id)] = x; });

  const items = assets.map((as) => {
    const f = byId[as.id] ?? FALLBACK_ITEMS[as.id] ?? {};
    return { ...as, assetType: as.type, ticker: as.id, score: clamp((f as { score?: number }).score ?? 0), summary: (f as { summary?: string }).summary ?? "", drivers: ((f as { drivers?: string[] }).drivers ?? []).slice(0, 3) };
  });

  const ovScore = json.overall?.score != null ? clamp(json.overall.score) : mean(items.map((i) => i.score));
  return { items, overall: { score: ovScore, note: json.overall?.note ?? FALLBACK_OVERALL.note }, source: "ai" };
}

export default function AnalysisPage() {
  const { holdings } = usePortfolio();
  const [data, setData]       = useState<AnalysisData | null>(SENT_CACHE);
  const [loading, setLoading] = useState(!SENT_CACHE);

  const run = async () => {
    setLoading(true);
    let res: AnalysisData;
    try { res = await runSentimentAI(holdings); }
    catch { res = buildFallback(holdings); }
    SENT_CACHE = res; setData(res); setLoading(false);
  };

  useEffect(() => {
    if (SENT_CACHE) return;
    let live = true;
    (async () => {
      let res: AnalysisData;
      try { res = await runSentimentAI(holdings); }
      catch { res = buildFallback(holdings); }
      if (live) { SENT_CACHE = res; setData(res); setLoading(false); }
    })();
    return () => { live = false; };
  }, [holdings]);

  const left  = data?.items.filter((_, i) => i % 2 === 0) ?? [];
  const right = data?.items.filter((_, i) => i % 2 === 1) ?? [];
  const skel  = holdings.filter((_, i) => i < 4);

  return (
    <div className="tab-body">
      <div className="an-head reveal">
        <div>
          <div className="an-eyebrow">AI Analysis</div>
          <h2>Market sentiment</h2>
          <div className="an-sub">A live read on every holding — direction, conviction, and the drivers moving each position.</div>
        </div>
        <div className="an-actions">
          <span className="an-ai-chip">
            <i />
            {loading ? "Analysing…" : data?.source === "ai" ? "Updated just now" : "Sample data"}
          </span>
          <button
            className="btn-gold"
            style={{ margin: 0, padding: "11px 18px", gridColumn: "auto" }}
            disabled={loading}
            onClick={run}
          >
            <Icon name="refresh" size={15} />{loading ? "Running" : "Re-run"}
          </button>
        </div>
      </div>

      {loading ? (
        <>
          <div className="card an-hero">
            <div className="anh-left">
              <div className="sk" style={{ width: 120, height: 12, marginBottom: 8 }} />
              <div className="sk" style={{ width: 160, height: 38, marginBottom: 8 }} />
              <div className="sk" style={{ width: 200, height: 12 }} />
            </div>
            <div className="anh-right">
              <div className="sk" style={{ height: 12, borderRadius: 8 }} />
              <div className="sk" style={{ height: 36, marginTop: 6 }} />
            </div>
          </div>
          <div className="sent-grid">
            <div className="sent-col">
              {skel.filter((_, i) => i % 2 === 0).map((h, i) => <SkelCard key={h.id} delay={i * 0.05} />)}
            </div>
            <div className="sent-col">
              {skel.filter((_, i) => i % 2 === 1).map((h, i) => <SkelCard key={h.id} delay={i * 0.05 + 0.04} />)}
            </div>
          </div>
        </>
      ) : data && (
        <>
          <Hero overall={data.overall} items={data.items} />
          <AskBox holdings={holdings} />
          <div className="sent-grid">
            <div className="sent-col">
              {left.map((it, i) => <SentCard key={it.id} it={it} delay={0.05 + i * 0.08} />)}
            </div>
            <div className="sent-col">
              {right.map((it, i) => <SentCard key={it.id} it={it} delay={0.09 + i * 0.08} />)}
            </div>
          </div>
          {data.source === "sample" && (
            <div className="an-note">
              <Icon name="file" size={13} />
              Showing curated sample data — set a real <code>ANTHROPIC_API_KEY</code> for a live read.
            </div>
          )}
        </>
      )}
    </div>
  );
}
