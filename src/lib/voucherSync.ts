import {
  collection, deleteDoc, doc, onSnapshot, query, serverTimestamp,
  setDoc, where, type Unsubscribe,
} from "firebase/firestore";
import type { VoucherEntry } from "../app/types";
import { db } from "./firebase";

const vouchers = collection(db, "vouchers");

function toVoucher(id: string, data: Record<string, unknown>): VoucherEntry {
  return { ...(data as VoucherEntry), firestoreId: id, id: typeof data.id === "number" ? data.id : Date.now(), voucherNo: String(data.voucherNo ?? id) };
}

export function subscribeOwnVouchers(ownerId: string, callback: (entries: VoucherEntry[]) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(vouchers, where("ownerId", "==", ownerId)),
    (snapshot) => callback(snapshot.docs.map((item) => toVoucher(item.id, item.data())).sort((a, b) => a.date.localeCompare(b.date))), onError);
}

export function subscribeAllVouchers(callback: (entries: VoucherEntry[]) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(vouchers,
    (snapshot) => callback(snapshot.docs.map((item) => toVoucher(item.id, item.data())).sort((a, b) => b.date.localeCompare(a.date))), onError);
}

export async function upsertVoucher(entry: VoucherEntry, ownerId: string, series: string): Promise<void> {
  const firestoreId = entry.firestoreId ?? `${ownerId}_${entry.voucherNo}`;
  await setDoc(doc(vouchers, firestoreId), {
    ...entry,
    ownerId,
    series,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export const deleteVoucher = (entry: VoucherEntry) => deleteDoc(doc(vouchers, entry.firestoreId ?? `${entry.ownerId}_${entry.voucherNo}`));
