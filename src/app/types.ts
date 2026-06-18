export type Direction = "paid" | "received";

export interface VoucherEntry {
  id: number;
  direction: Direction;
  vendor: string;
  amount: number;
  account: string;
  date: string;
  voucherNo: string;
  splitGroup?: { index: number; total: number };
}

export type Tab = "generate" | "master" | "history";

export const DEFAULT_SPLIT_THRESHOLD = 10000;
