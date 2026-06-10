import { createTableListGET } from "@/lib/api/list-route";

export interface CurrencyRow {
  code: string;
  label: string;
  active: boolean;
  display_order: number;
}

const FALLBACK: CurrencyRow[] = [
  { code: "SGD", label: "Singapore Dollar",  active: true, display_order: 1 },
  { code: "USD", label: "US Dollar",         active: true, display_order: 2 },
  { code: "EUR", label: "Euro",              active: true, display_order: 3 },
  { code: "GBP", label: "British Pound",     active: true, display_order: 4 },
  { code: "AUD", label: "Australian Dollar", active: true, display_order: 5 },
  { code: "JPY", label: "Japanese Yen",      active: true, display_order: 6 },
  { code: "INR", label: "Indian Rupee",      active: true, display_order: 7 },
  { code: "HKD", label: "Hong Kong Dollar",  active: true, display_order: 8 },
];

export const GET = createTableListGET<CurrencyRow>(
  "currencies",
  "code, label, active, display_order",
  FALLBACK
);
