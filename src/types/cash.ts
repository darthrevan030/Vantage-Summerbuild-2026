export type CashTransactionType =
  | "deposit"
  | "withdrawal"
  | "transfer"
  | "fee"
  | "dividend_cash"
  | "buy"
  | "sell";

export interface CashTransaction {
  id: string;
  lotId: string | null;
  transferGroupId: string | null;
  date: string;
  type: CashTransactionType;
  currency: string;
  amount: number;
  fxRate: number;
  broker: string;
  source: string;
  note: string | null;
}
