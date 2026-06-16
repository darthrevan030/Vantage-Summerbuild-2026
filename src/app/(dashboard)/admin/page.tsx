import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProviderFlags } from "@/lib/supabase/app-config";
import { RoleToggle } from "./RoleToggle";
import { ActiveToggle } from "./ActiveToggle";
import { DeleteUserButton } from "./DeleteUserButton";
import { isAdminRole } from "@/lib/roles";
import type { CurrencyRow } from "@/app/api/currencies/route";
import type { ExchangeRow } from "@/app/api/exchanges/route";

interface AdminUserRow {
  id: string;
  email: string;
  joinedAt: string;
  displayName: string;
  role: string;
  holdingCount: number;
}

interface StaleTicker {
  id: string;
  ticker: string;
  name: string;
  priceRefreshedAt: string | null;
}

export default async function AdminPage() {
  // --- Auth: cookie-based check ---
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: mySettings } = await supabase
    .from("user_settings")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!isAdminRole(mySettings?.role)) redirect("/overview");
  const viewerRole = mySettings?.role ?? "admin";

  // --- Data: anon client for RLS-governed queries, admin only for auth.users ---
  const adminClient = createAdminClient();
  const staleThreshold = new Date(Date.now() - 3_600_000).toISOString();

  const [
    { data: authData },
    { data: settingsRows },
    { data: holdingsByUser },
    { count: totalHoldings },
    { data: staleRows },
    { count: staleCount },
    { data: instrumentRows },
    { data: currencyRows },
    { data: exchangeRows },
    providerFlags,
  ] = await Promise.all([
    adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("user_settings").select("user_id, display_name, role"),
    supabase.from("lots").select("user_id"),
    supabase.from("lots").select("*", { count: "exact", head: true }),
    // Stale prices now live in the shared ticker_quotes cache, keyed by symbol
    supabase
      .from("ticker_quotes")
      .select("symbol, refreshed_at")
      .or(`refreshed_at.is.null,refreshed_at.lt.${staleThreshold}`)
      .order("refreshed_at", { ascending: true, nullsFirst: true }),
    supabase
      .from("ticker_quotes")
      .select("*", { count: "exact", head: true })
      .or(`refreshed_at.is.null,refreshed_at.lt.${staleThreshold}`),
    supabase.from("instruments").select("symbol, name"),
    supabase
      .from("currencies")
      .select("code, label, active, display_order")
      .order("display_order"),
    supabase
      .from("exchanges")
      .select("code, label, region, active, display_order")
      .order("display_order"),
    getProviderFlags(),
  ]);

  // Build per-user holding counts
  const holdingCountByUser: Record<string, number> = {};
  (holdingsByUser ?? []).forEach((row: { user_id: string }) => {
    holdingCountByUser[row.user_id] =
      (holdingCountByUser[row.user_id] ?? 0) + 1;
  });

  // Merge settings map
  const settingsMap: Record<string, { displayName: string; role: string }> = {};
  (settingsRows ?? []).forEach(
    (s: { user_id: string; display_name: string | null; role: string }) => {
      settingsMap[s.user_id] = {
        displayName: s.display_name ?? "",
        role: s.role,
      };
    },
  );

  const tableRows: AdminUserRow[] = (
    (authData as { users: User[] } | null)?.users ?? []
  ).map((u: User) => ({
    id: u.id,
    email: u.email ?? "(no email)",
    joinedAt: u.created_at,
    displayName: settingsMap[u.id]?.displayName ?? "",
    role: settingsMap[u.id]?.role ?? "user",
    holdingCount: holdingCountByUser[u.id] ?? 0,
  }));

  // Resolve symbol → display name from the instruments table
  const nameBySymbol: Record<string, string> = {};
  (instrumentRows as { symbol: string; name: string }[] | null ?? []).forEach(
    (i) => {
      if (!nameBySymbol[i.symbol]) nameBySymbol[i.symbol] = i.name;
    },
  );

  const staleTickers: StaleTicker[] = (
    (staleRows as
      | {
          symbol: string;
          refreshed_at: string | null;
        }[]
      | null) ?? []
  ).map((r) => ({
    id: r.symbol,
    ticker: r.symbol,
    name: nameBySymbol[r.symbol] ?? r.symbol,
    priceRefreshedAt: r.refreshed_at,
  }));

  return (
    <div className="flex w-full min-w-0 flex-col gap-[18px]">
      <div className="mb-0.5 flex flex-wrap items-end justify-between gap-[18px] animate-reveal">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[.14em] text-gold">
            Admin
          </div>
          <h2 className="mb-1 mt-1.5 font-serif text-[26px] font-normal tracking-[.2px]">
            Dashboard
          </h2>
          <div className="max-w-[440px] text-[13px] text-secondary">
            System health, user management, and price cache status.
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3.5 animate-reveal max-bp1080:grid-cols-2 max-bp480:grid-cols-2">
        <div className="relative flex flex-col gap-[5px] rounded-[14px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%),var(--bg-surface)] px-[18px] py-4 shadow-card transition-[transform,border-color,box-shadow] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-[rgba(186,170,255,0.18)] hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.9)] max-bp600:px-3.5 max-bp600:py-[13px] max-bp480:px-3 max-bp480:py-[11px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted">
            Total Users
          </span>
          <span className="font-mono text-[23px] font-semibold tracking-[-.01em] tabular-nums max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px]">
            {tableRows.length}
          </span>
        </div>
        <div className="relative flex flex-col gap-[5px] rounded-[14px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%),var(--bg-surface)] px-[18px] py-4 shadow-card transition-[transform,border-color,box-shadow] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-[rgba(186,170,255,0.18)] hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.9)] max-bp600:px-3.5 max-bp600:py-[13px] max-bp480:px-3 max-bp480:py-[11px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted">
            Total Holdings
          </span>
          <span className="font-mono text-[23px] font-semibold tracking-[-.01em] tabular-nums max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px]">
            {totalHoldings ?? 0}
          </span>
        </div>
        <div className="relative flex flex-col gap-[5px] rounded-[14px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.025),transparent_42%),var(--bg-surface)] px-[18px] py-4 shadow-card transition-[transform,border-color,box-shadow] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-[3px] hover:border-[rgba(186,170,255,0.18)] hover:shadow-[0_22px_44px_-26px_rgba(0,0,0,0.9)] max-bp600:px-3.5 max-bp600:py-[13px] max-bp480:px-3 max-bp480:py-[11px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted">
            Stale Prices
          </span>
          <span
            className="font-mono text-[23px] font-semibold tracking-[-.01em] tabular-nums max-bp600:text-[19px] max-bp480:text-[17px] max-bp380:text-[15px]"
            style={{
              color: (staleCount ?? 0) > 0 ? "var(--loss)" : "var(--gain)",
            }}
          >
            {staleCount ?? 0}
          </span>
          <span className="font-ui text-xs text-secondary">
            null or &gt;1 h old
          </span>
        </div>
      </div>

      {/* User table */}
      <div
        className="card px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3"
        style={{ animationDelay: ".06s" }}
      >
        <div className="mb-4 flex items-baseline justify-between max-bp600:flex-wrap max-bp600:items-center max-bp600:gap-2">
          <span className="text-[13px] font-semibold tracking-[.01em] text-primary">
            Users
          </span>
          <span className="font-ui text-[11px] text-secondary">
            {tableRows.length} accounts
          </span>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-subtle">
              {["Email", "Joined", "Display Name", "Holdings", "Role", ""].map(
                (h, i) => (
                  <th
                    key={h || "actions"}
                    className={
                      "py-2 px-0 font-ui text-[11px] font-medium tracking-[.04em] text-secondary " +
                      (i >= 3 ? "text-right" : "text-left")
                    }
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.id} className="border-b border-subtle">
                <td className="py-2.5 font-mono text-xs tabular-nums">
                  {row.email}
                </td>
                <td className="py-2.5 font-ui text-xs text-secondary">
                  {new Date(row.joinedAt).toLocaleDateString("en-SG", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
                <td className="py-2.5 font-ui text-xs">
                  {row.displayName || "—"}
                </td>
                <td className="py-2.5 text-right font-mono text-xs tabular-nums">
                  {row.holdingCount}
                </td>
                <td className="py-2.5 text-right">
                  <RoleToggle
                    userId={row.id}
                    initialRole={row.role}
                    viewerRole={viewerRole}
                  />
                </td>
                <td className="py-2.5 text-right">
                  <DeleteUserButton
                    userId={row.id}
                    email={row.email}
                    targetRole={row.role}
                    viewerRole={viewerRole}
                    isSelf={row.id === user.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Price cache health */}
      <div
        className="card px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3"
        style={{ animationDelay: ".12s" }}
      >
        <div className="mb-4 flex items-baseline justify-between max-bp600:flex-wrap max-bp600:items-center max-bp600:gap-2">
          <span className="text-[13px] font-semibold tracking-[.01em] text-primary">
            Price Cache Health
          </span>
          <span
            className="font-ui text-[11px] text-secondary"
            style={{
              color: staleTickers.length > 0 ? "var(--loss)" : undefined,
            }}
          >
            {staleTickers.length === 0
              ? "All fresh"
              : `${staleTickers.length} stale`}
          </span>
        </div>
        {staleTickers.length === 0 ? (
          <div className="py-3 font-ui text-[13px] text-secondary">
            All prices were refreshed within the last hour.
          </div>
        ) : (
          <div className="flex flex-col">
            {staleTickers.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between border-b border-subtle py-[9px]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs tabular-nums">
                    {t.ticker}
                  </span>
                  <span className="font-ui text-xs text-secondary">
                    {t.name}
                  </span>
                </div>
                <span className="font-ui text-[11px] tracking-[.04em] text-secondary">
                  {t.priceRefreshedAt
                    ? new Date(t.priceRefreshedAt).toLocaleString("en-SG")
                    : "never refreshed"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Currency editor */}
      <div
        className="card px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3"
        style={{ animationDelay: ".18s" }}
      >
        <div className="mb-4 flex items-baseline justify-between max-bp600:flex-wrap max-bp600:items-center max-bp600:gap-2">
          <span className="text-[13px] font-semibold tracking-[.01em] text-primary">
            Supported Currencies
          </span>
          <span className="font-ui text-[11px] text-secondary">
            {(currencyRows ?? []).filter((c: CurrencyRow) => c.active).length}{" "}
            active
          </span>
        </div>
        <div>
          {(currencyRows ?? []).map((c: CurrencyRow) => (
            <ActiveToggle
              key={c.code}
              code={c.code}
              label={c.label}
              initialActive={c.active}
              endpoint="/api/admin/currencies"
            />
          ))}
        </div>
      </div>

      {/* Exchange editor */}
      <div
        className="card px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3"
        style={{ animationDelay: ".24s" }}
      >
        <div className="mb-4 flex items-baseline justify-between max-bp600:flex-wrap max-bp600:items-center max-bp600:gap-2">
          <span className="text-[13px] font-semibold tracking-[.01em] text-primary">
            Supported Exchanges
          </span>
          <span className="font-ui text-[11px] text-secondary">
            {(exchangeRows ?? []).filter((e: ExchangeRow) => e.active).length}{" "}
            active
          </span>
        </div>
        <div>
          {(exchangeRows ?? []).map((e: ExchangeRow) => (
            <ActiveToggle
              key={e.code}
              code={e.code}
              label={e.label}
              region={e.region}
              initialActive={e.active}
              endpoint="/api/admin/exchanges"
              codeMinWidth={48}
            />
          ))}
        </div>
      </div>

      {/* API provider toggles */}
      <div
        className="card px-5 py-4.5 animate-reveal max-bp768:overflow-hidden max-bp480:p-3.5 max-bp380:p-3"
        style={{ animationDelay: ".30s" }}
      >
        <div className="mb-4 flex items-baseline justify-between max-bp600:flex-wrap max-bp600:items-center max-bp600:gap-2">
          <span className="text-[13px] font-semibold tracking-[.01em] text-primary">
            Price Data Providers
          </span>
          <span className="font-ui text-[11px] text-secondary">
            disable to preserve quotas during testing
          </span>
        </div>
        <div>
          {(
            [
              {
                code: "eodhd",
                label: "EODHD",
                region: "Equities — primary (limited daily quota)",
                active: providerFlags.eodhd,
              },
              {
                code: "yahoo",
                label: "Yahoo Finance",
                region: "Equities — fallback",
                active: providerFlags.yahoo,
              },
              {
                code: "coingecko",
                label: "CoinGecko",
                region: "Crypto prices & sparklines",
                active: providerFlags.coingecko,
              },
              {
                code: "goldapi",
                label: "Gold API",
                region: "Gold spot price",
                active: providerFlags.goldapi,
              },
              {
                code: "finnhub",
                label: "Finnhub",
                region: "Equity sparklines, quotes, news, FX candles",
                active: providerFlags.finnhub,
              },
              {
                code: "frankfurter",
                label: "Frankfurter",
                region: "Live & historical FX rates",
                active: providerFlags.frankfurter,
              },
              {
                code: "anthropic",
                label: "Anthropic",
                region: "Analyst AI (Claude)",
                active: providerFlags.anthropic,
              },
            ] as {
              code: string;
              label: string;
              region: string;
              active: boolean;
            }[]
          ).map((p) => (
            <ActiveToggle
              key={p.code}
              code={p.code}
              label={p.label}
              region={p.region}
              initialActive={p.active}
              endpoint="/api/admin/config"
              codeMinWidth={72}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
