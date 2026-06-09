import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RoleToggle } from "./RoleToggle";
import { CurrencyToggle } from "./CurrencyToggle";
import { ExchangeToggle } from "./ExchangeToggle";
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

  if (mySettings?.role !== "admin") redirect("/overview");

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
    { data: currencyRows },
    { data: exchangeRows },
  ] = await Promise.all([
    adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("user_settings").select("user_id, display_name, role"),
    supabase.from("holdings").select("user_id"),
    supabase.from("holdings").select("*", { count: "exact", head: true }),
    supabase
      .from("holdings")
      .select("id, ticker, name, price_refreshed_at")
      .or(`price_refreshed_at.is.null,price_refreshed_at.lt.${staleThreshold}`)
      .order("price_refreshed_at", { ascending: true, nullsFirst: true }),
    supabase
      .from("holdings")
      .select("*", { count: "exact", head: true })
      .or(`price_refreshed_at.is.null,price_refreshed_at.lt.${staleThreshold}`),
    supabase
      .from("currencies")
      .select("code, label, active, display_order")
      .order("display_order"),
    supabase
      .from("exchanges")
      .select("code, label, region, active, display_order")
      .order("display_order"),
  ]);

  // Build per-user holding counts
  const holdingCountByUser: Record<string, number> = {};
  (holdingsByUser ?? []).forEach((row: { user_id: string }) => {
    holdingCountByUser[row.user_id] = (holdingCountByUser[row.user_id] ?? 0) + 1;
  });

  // Merge settings map
  const settingsMap: Record<string, { displayName: string; role: string }> = {};
  (settingsRows ?? []).forEach(
    (s: { user_id: string; display_name: string | null; role: string }) => {
      settingsMap[s.user_id] = { displayName: s.display_name ?? "", role: s.role };
    }
  );

  const tableRows: AdminUserRow[] = ((authData as { users: User[] } | null)?.users ?? []).map(
    (u: User) => ({
      id: u.id,
      email: u.email ?? "(no email)",
      joinedAt: u.created_at,
      displayName: settingsMap[u.id]?.displayName ?? "",
      role: settingsMap[u.id]?.role ?? "user",
      holdingCount: holdingCountByUser[u.id] ?? 0,
    })
  );

  const staleTickers: StaleTicker[] = (
    staleRows as { id: string; ticker: string; name: string; price_refreshed_at: string | null }[] | null ?? []
  ).map((r) => ({
    id: r.id,
    ticker: r.ticker,
    name: r.name,
    priceRefreshedAt: r.price_refreshed_at,
  }));

  return (
    <div className="tab-body">
      <div className="an-head reveal">
        <div>
          <div className="an-eyebrow">Admin</div>
          <h2>Dashboard</h2>
          <div className="an-sub">
            System health, user management, and price cache status.
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="stat-row reveal">
        <div className="stat-card">
          <span className="stat-label">Total Users</span>
          <span className="mono stat-value">{tableRows.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Holdings</span>
          <span className="mono stat-value">{totalHoldings ?? 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Stale Prices</span>
          <span
            className="mono stat-value"
            style={{ color: (staleCount ?? 0) > 0 ? "var(--loss)" : "var(--gain)" }}
          >
            {staleCount ?? 0}
          </span>
          <span className="ui stat-sub muted">null or &gt;1 h old</span>
        </div>
      </div>

      {/* User table */}
      <div className="card reveal" style={{ animationDelay: ".06s" }}>
        <div className="card-head">
          <span className="card-title">Users</span>
          <span className="ui muted">{tableRows.length} accounts</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              {["Email", "Joined", "Display Name", "Holdings", "Role"].map((h, i) => (
                <th
                  key={h}
                  className="ui muted xs"
                  style={{
                    textAlign: i >= 3 ? "right" : "left",
                    padding: "8px 0",
                    fontWeight: 500,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td className="mono" style={{ padding: "10px 0", fontSize: 12 }}>
                  {row.email}
                </td>
                <td className="ui muted" style={{ padding: "10px 0", fontSize: 12 }}>
                  {new Date(row.joinedAt).toLocaleDateString("en-SG", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
                <td className="ui" style={{ padding: "10px 0", fontSize: 12 }}>
                  {row.displayName || "—"}
                </td>
                <td
                  className="mono"
                  style={{ padding: "10px 0", fontSize: 12, textAlign: "right" }}
                >
                  {row.holdingCount}
                </td>
                <td style={{ padding: "10px 0", textAlign: "right" }}>
                  <RoleToggle userId={row.id} initialRole={row.role} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Price cache health */}
      <div className="card reveal" style={{ animationDelay: ".12s" }}>
        <div className="card-head">
          <span className="card-title">Price Cache Health</span>
          <span
            className="ui muted"
            style={{ color: staleTickers.length > 0 ? "var(--loss)" : undefined }}
          >
            {staleTickers.length === 0 ? "All fresh" : `${staleTickers.length} stale`}
          </span>
        </div>
        {staleTickers.length === 0 ? (
          <div className="ui muted" style={{ padding: "12px 0", fontSize: 13 }}>
            All prices were refreshed within the last hour.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {staleTickers.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "9px 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="mono" style={{ fontSize: 12 }}>{t.ticker}</span>
                  <span className="ui muted" style={{ fontSize: 12 }}>{t.name}</span>
                </div>
                <span className="ui muted xs">
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
      <div className="card reveal" style={{ animationDelay: ".18s" }}>
        <div className="card-head">
          <span className="card-title">Supported Currencies</span>
          <span className="ui muted">
            {(currencyRows ?? []).filter((c: CurrencyRow) => c.active).length} active
          </span>
        </div>
        <div>
          {(currencyRows ?? []).map((c: CurrencyRow) => (
            <CurrencyToggle key={c.code} currency={c} />
          ))}
        </div>
      </div>

      {/* Exchange editor */}
      <div className="card reveal" style={{ animationDelay: ".24s" }}>
        <div className="card-head">
          <span className="card-title">Supported Exchanges</span>
          <span className="ui muted">
            {(exchangeRows ?? []).filter((e: ExchangeRow) => e.active).length} active
          </span>
        </div>
        <div>
          {(exchangeRows ?? []).map((e: ExchangeRow) => (
            <ExchangeToggle key={e.code} exchange={e} />
          ))}
        </div>
      </div>
    </div>
  );
}
