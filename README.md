# Finance Dashboard — Summerbuild 2026

A personal portfolio tracker with real-time FX conversion, AI analysis, and a terminal-inspired UI. Built with Next.js 15 (App Router) and Supabase.

## Features

- **Holdings** — CRUD for stocks, ETFs, REITs, crypto, gold, and real estate; live price refresh with 1-hour Supabase cache
- **Overview** — Portfolio value in any base currency, total gain/loss, FX gain/loss, cost vs. value summary rail
- **FX Lab** — Currency impact analysis with date-range charts and a dumbbell gain/loss breakdown
- **Charts** — Asset allocation donut, portfolio trend area chart, spark lines; 1D–All time presets + custom date picker
- **Analysis** — Claude-powered AI analyst with grounded sentiment (real price sparkData anchors AI scores and 30-day trend chart)
- **Add / Import** — Form to add new holdings with full field validation
- **Settings** — Display name, base currency selector (SGD, USD, EUR, GBP, JPY, AUD, HKD, INR)
- **Admin** — User management, role toggle, price cache health (accessible at `/admin` for users with `role = 'admin'`)

## Tech Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router, React 19) |
| Auth | Supabase Magic Link (PKCE flow) |
| Database | Supabase Postgres with RLS |
| AI | Anthropic Claude SDK |
| Styling | CSS Modules (terminal palette) |
| Analytics | Vercel Analytics |

## Project Structure

```text
src/
├── app/
│   ├── (auth)/           # Login + PKCE callback
│   ├── (dashboard)/      # Protected tab pages (overview, holdings, fx-lab, charts, analysis, add, settings, admin)
│   └── api/              # Route handlers (holdings CRUD, prices, FX, quotes, analyst, news, settings, admin)
├── components/
│   ├── charts/           # AreaTrend, Donut, Dumbbell, FXArea, Spark, Legend
│   ├── DashboardShell    # Top-level layout wrapper
│   ├── NerveBar          # Header with base-currency dropdown
│   ├── TabBar            # Navigation tabs with icons
│   ├── TweaksPanel       # Theme colour picker
│   └── Select            # Custom dropdown component
├── context/portfolio.tsx  # Global portfolio state + derived metrics
├── lib/
│   ├── supabase/         # server.ts, client.ts, admin.ts (Secret API key client), data queries
│   ├── portfolio.ts      # Series generation + FX math
│   ├── prices.ts         # Shared price-fetch logic (Yahoo Finance proxy)
│   ├── formatters.ts     # fmtVal / fmtSigned base-currency formatters
│   └── fx.ts             # FX rate helpers + fallback rates
└── types/                # HoldingRow, PortfolioSnapshot, UserSettings, etc.
```

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project with the schema below

### Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
ANTHROPIC_API_KEY=your_anthropic_api_key
FINNHUB_API_KEY=your_finnhub_api_key

# Server-only — never expose to the browser.
# Use a Secret API key (Supabase > Project Settings > API > Secret API Keys)
# rather than the master service_role key. Required only for auth.admin.listUsers().
SUPABASE_ADMIN_KEY=your_supabase_secret_api_key
```

### Database Schema

Run in the Supabase SQL editor:

```sql
create table holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  ticker text not null,
  name text not null,
  asset_type text not null,
  broker text,
  strategy text,
  units numeric not null,
  currency text not null,
  flag text,
  icon text,
  buy_price numeric not null,
  buy_date date not null,
  buy_fx_rate numeric,
  current_price numeric,
  current_fx_rate numeric,
  spark_data numeric[],
  notes text,
  price_refreshed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table holdings enable row level security;
create policy "users see own holdings" on holdings for all using (auth.uid() = user_id);

create table user_settings (
  user_id uuid primary key references auth.users,
  display_name text,
  base_currency text default 'SGD',
  role text not null default 'user',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table user_settings enable row level security;
create policy "users see own settings" on user_settings for all using ((auth.uid())::text = user_id);

-- Admin RLS: allows users with role='admin' to read/write all rows.
-- SECURITY DEFINER on is_admin() prevents recursive policy evaluation.
create or replace function is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from user_settings where user_id = (auth.uid())::text and role = 'admin');
$$;

create policy "admins select all settings" on user_settings for select using ((auth.uid())::text = user_id or is_admin());
create policy "admins update any settings" on user_settings for update using (is_admin());
create policy "admins select all holdings" on holdings for select using ((auth.uid())::text = user_id or is_admin());
```

### First Deploy — Admin Bootstrap

The very first admin must be seeded directly (no chicken-and-egg UI):

```sql
-- Find your UUID in Supabase → Authentication → Users
update user_settings set role = 'admin' where user_id = '<your-uuid>';
```

After this one-time step, all further role changes go through the `/admin` UI (role toggle on each user row).

### Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to `/login` — enter your email to receive a magic link.

## API Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/holdings` | GET / POST / PATCH / DELETE | Holdings CRUD |
| `/api/holdings/refresh` | POST | Refresh stale prices (1-hour cache) |
| `/api/prices` | GET | Fetch current price for a ticker |
| `/api/fx` | GET | FX rate lookup |
| `/api/quotes` | GET | Batch quote fetch |
| `/api/analyst` | POST | Claude AI portfolio analysis (SSE stream) |
| `/api/news` | GET | Finnhub news headlines with keyword sentiment |
| `/api/settings` | GET / POST | User settings |
| `/api/admin/users/[id]` | PATCH | Toggle user role (`admin` ↔ `user`) — admin only |
