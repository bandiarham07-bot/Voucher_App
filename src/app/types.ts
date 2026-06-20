export type PaymentType = "नगदी" | "चेक" | "ऑनलाइन";

export interface VoucherLineItem {
  account: string;
  amount: number;
  remarks?: string;
}

export interface VoucherEntry {
  id: number;
  vendor: string;
  amount: number;
  account: string;
  lineItems?: VoucherLineItem[];
  haste?: string;
  remarks?: string;
  paymentType: PaymentType;
  chequeNo?: string;
  bankName?: string;
  date: string;
  voucherNo: string;
  splitGroup?: { index: number; total: number; groupId?: number };
}

export type Tab = "generate" | "master" | "history";

export const DEFAULT_SPLIT_THRESHOLD = 9000;
export const SPLIT_TRIGGER_AMOUNT = 10000;
