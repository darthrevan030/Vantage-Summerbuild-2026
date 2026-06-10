import type { Metadata } from "next";
import { Icon } from "@/components/Icon";
import { AuroraField } from "@/components/landing/AuroraField";
import { LandingNav } from "@/components/landing/LandingNav";
import { Reveal } from "@/components/landing/Reveal";
import { KineticHeadline } from "@/components/landing/KineticHeadline";
import { HeroFxSplit } from "@/components/landing/HeroFxSplit";
import { LiveTerminal } from "@/components/landing/LiveTerminal";
import { SpotlightCard } from "@/components/landing/SpotlightCard";
import { CountUp } from "@/components/landing/CountUp";
import { HowItWorksScroll } from "@/components/landing/HowItWorksScroll";
import { MagneticButton } from "@/components/landing/MagneticButton";

export const metadata: Metadata = {
  title: "Portfolio — Personal Wealth Terminal",
  description:
    "Track stocks, ETFs, crypto, gold and property across 32 global exchanges. Live prices, FX-aware P&L, charts and AI analysis — with your data in your own database.",
  openGraph: {
    title: "Portfolio — Personal Wealth Terminal",
    description: "Every holding. Every currency. One terminal.",
    type: "website",
  },
  twitter: { card: "summary" },
};

const CTA_PILL =
  "rounded-full bg-gold px-7 py-3.5 font-ui text-[14px] font-semibold text-[#15130c] transition-[filter] hover:brightness-110";
const CTA_GHOST =
  "rounded-full border border-subtle px-7 py-3.5 font-ui text-[14px] font-medium text-secondary transition-colors hover:border-gold-soft hover:text-primary";

const FEATURES: {
  icon: string;
  title: string;
  copy: string;
  wide?: boolean;
  visual?: "dumbbell" | "stream";
}[] = [
  {
    icon: "repeat",
    title: "FX Lab",
    copy: "See how much of every gain is the asset — and how much is the exchange rate. Per-currency waterfalls split asset P&L from FX drift, so a weak dollar never masquerades as a winning stock.",
    wide: true,
    visual: "dumbbell",
  },
  {
    icon: "sparkles",
    title: "AI analysis",
    copy: "Portfolio commentary streamed by Claude — grounded in your real positions, 30-day trends and recent headlines, not vibes. Ask it anything about what you own.",
    wide: true,
    visual: "stream",
  },
  { icon: "layers", title: "Everything you own", copy: "Stocks, ETFs, REITs, crypto, gold and property — six asset classes, one table, one number that means something." },
  { icon: "refresh", title: "Live prices", copy: "On-demand refresh across global equities, CoinGecko and gold spot, with a smart cache that never hammers the APIs." },
  { icon: "bar-chart", title: "Charts that answer", copy: "Value over time, allocation donuts, per-holding sparklines and custom date ranges — built to settle arguments with yourself." },
  { icon: "landmark", title: "Private by design", copy: "CSV import in, CSV backup out. Everything lives in your own Supabase project — your data never feeds anyone else's model." },
];

const NUMBERS = [
  { value: 32, label: "Global exchanges", suffix: "" },
  { value: 8, label: "Base currencies", suffix: "" },
  { value: 6, label: "Asset classes", suffix: "" },
  { value: 100, label: "Your own data", suffix: "%" },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip">
      <noscript>
        <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
      </noscript>

      <AuroraField />
      <LandingNav />

      <main>
        {/* ───────────────────────────── hero ───────────────────────────── */}
        <section className="mx-auto max-w-[1140px] px-6 pb-20 pt-36 text-center md:pt-44">
          <Reveal>
            <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-gold">
              Personal wealth terminal
            </div>
          </Reveal>

          <KineticHeadline
            text="Every holding. Every currency. *One* terminal."
            className="mx-auto mt-5 max-w-[860px] font-serif text-[clamp(46px,7.5vw,92px)] leading-[1.04] tracking-[-0.015em] text-primary"
          />

          <Reveal delay={120}>
            <p className="mx-auto mt-7 max-w-[52ch] font-ui text-[17px] leading-[1.65] text-secondary">
              Track stocks, ETFs, crypto, gold and property across 32 global
              exchanges — live prices, FX-aware P&amp;L and AI analysis. Your
              data stays in your own database.
            </p>
          </Reveal>

          <Reveal delay={200}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3.5">
              <MagneticButton href="/login" className={CTA_PILL}>Get Started</MagneticButton>
              <a href="#fxsplit" className={CTA_GHOST}>See what&rsquo;s inside&ensp;↓</a>
            </div>
          </Reveal>

          {/* signature interactive centerpiece */}
          <div id="fxsplit" className="mt-20 scroll-mt-24">
            <HeroFxSplit />
          </div>

          {/* live product preview */}
          <div className="relative mt-20 md:mt-24">
            <Reveal>
              <LiveTerminal />
            </Reveal>
          </div>
        </section>

        {/* ─────────────────────────── features ─────────────────────────── */}
        <section id="features" className="mx-auto max-w-[1140px] scroll-mt-20 px-6 py-24 md:py-36">
          <Reveal>
            <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-gold">Capabilities</div>
            <h2 className="mt-4 max-w-[640px] font-serif text-[clamp(34px,4.5vw,54px)] leading-[1.08] text-primary">
              Know what&rsquo;s working. And&nbsp;why.
            </h2>
            <p className="mt-5 max-w-[52ch] font-ui text-[15px] leading-[1.65] text-secondary">
              A portfolio is more than a list of tickers. It&rsquo;s positions,
              currencies, costs and time — and the answers live in how they interact.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 4) * 80} className={f.wide ? "lg:col-span-2" : ""}>
                <SpotlightCard className="h-full">
                  <div className="flex h-full flex-col p-7">
                    <div className="mb-5 grid size-9 place-items-center rounded-[9px] border border-subtle bg-elevated text-gold">
                      <Icon name={f.icon} size={17} />
                    </div>
                    <h3 className="mb-2 font-ui text-[16px] font-semibold text-primary">{f.title}</h3>
                    <p className="font-ui text-[13.5px] leading-relaxed text-secondary">{f.copy}</p>

                    {f.visual === "dumbbell" && (
                      <div aria-hidden className="mt-auto pt-7">
                        <div className="relative h-5">
                          <div className="absolute inset-x-0 top-[9px] h-0.5 rounded-full bg-subtle" />
                          <div className="absolute bottom-0.5 left-1/2 top-0.5 w-px bg-muted/60" />
                          <div className="absolute left-[18%] top-2 h-1.5 w-[30%] rounded-full bg-gain/80" />
                          <div className="absolute left-[58%] top-[5px] h-2.5 w-[18%] rounded-full bg-fx-up/90" />
                          <div className="absolute left-[76%] top-1 h-3 border-l-2 border-gold" />
                        </div>
                        <div className="mt-2 flex justify-between font-mono text-[9.5px] tracking-[.06em] text-muted">
                          <span>ASSET +S$3,240</span><span>FX +S$1,180</span>
                        </div>
                      </div>
                    )}
                    {f.visual === "stream" && (
                      <div aria-hidden className="mt-auto pt-7">
                        <div className="rounded-xl border border-subtle bg-elevated/60 p-4 font-ui text-[12px] leading-[1.7] text-secondary">
                          <span className="text-gold">▸</span> Your SGD exposure cushioned this
                          week&rsquo;s USD drawdown — about 38% of the dip was currency, not
                          <span className="ml-1 inline-block h-3.5 w-[7px] animate-blink bg-gold align-[-2px]" />
                        </div>
                      </div>
                    )}
                  </div>
                </SpotlightCard>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ───────────────────────── numbers band ───────────────────────── */}
        <section className="border-y border-subtle">
          <div className="mx-auto grid max-w-[1140px] grid-cols-2 gap-10 px-6 py-14 text-center md:grid-cols-4 md:py-16">
            {NUMBERS.map((n) => (
              <Reveal key={n.label}>
                <div className="font-mono text-[clamp(30px,4vw,42px)] font-semibold text-gold">
                  <CountUp to={n.value} suffix={n.suffix} />
                </div>
                <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[.12em] text-secondary">{n.label}</div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ───────────────────────── how it works ───────────────────────── */}
        <HowItWorksScroll />

        {/* ───────────────────────── closing CTA ───────────────────────── */}
        <section className="relative mx-auto max-w-[1140px] px-6 py-28 text-center md:py-40">
          <Reveal>
            <h2 className="mx-auto max-w-[18ch] font-serif text-[clamp(40px,6vw,76px)] leading-[1.05] tracking-[-0.01em] text-primary">
              Your whole portfolio, finally in <span className="italic text-gold">focus</span>.
            </h2>
            <div className="mt-10 flex justify-center">
              <MagneticButton href="/login" className={CTA_PILL}>Start tracking&ensp;→</MagneticButton>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ─────────────────────────── footer ─────────────────────────── */}
      <footer className="border-t border-subtle">
        <div className="mx-auto flex max-w-[1140px] flex-wrap items-center justify-between gap-6 px-6 py-12">
          <div>
            <div className="font-serif text-[18px] text-gold [text-shadow:0_0_18px_var(--accent-glow)]">Portfolio</div>
            <div className="mt-1.5 font-ui text-[11.5px] text-muted">Personal finance dashboard — data stays private</div>
          </div>
          <div className="flex items-center gap-6 font-ui text-[12px] text-secondary">
            <a href="/login" className="transition-colors hover:text-primary">Sign in</a>
            <span className="text-muted">© 2026 Portfolio</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
