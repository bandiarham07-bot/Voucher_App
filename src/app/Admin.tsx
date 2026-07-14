import { useEffect, useState } from "react";
import { Download, Trash2, X } from "lucide-react";
import type { VoucherEntry } from "./types";
import { signInAdmin, signOutAdmin, isAdmin } from "../lib/adminAuth";
import { deleteVoucher, subscribeAllVouchers } from "../lib/voucherSync";
import { openVoucherPDF, voucherEntryToPDFEntry } from "../lib/pdf";

export default function Admin({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [entries, setEntries] = useState<VoucherEntry[]>([]);
  const [loggedIn, setLoggedIn] = useState(isAdmin());
  useEffect(() => loggedIn ? subscribeAllVouchers(setEntries, () => setError("Could not load vouchers. Check Firestore rules.")) : undefined, [loggedIn]);
  async function login() { try { await signInAdmin(email, password); if (!isAdmin()) { await signOutAdmin(); throw new Error(); } setLoggedIn(true); } catch { setError("Invalid admin email or password."); } }
  return <div className="fixed inset-0 z-[60] bg-background max-w-md mx-auto flex flex-col">
    <div className="px-5 pt-14 pb-3 border-b border-border flex justify-between"><h1 className="text-xl font-semibold">Admin</h1><button onClick={onClose}><X /></button></div>
    {!loggedIn ? <div className="p-5 flex flex-col gap-3"><input className="h-12 bg-muted rounded-xl px-3" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /><input className="h-12 bg-muted rounded-xl px-3" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /><button onClick={() => void login()} className="h-12 rounded-xl bg-primary text-white font-semibold">Sign in</button>{error && <p className="text-sm text-destructive">{error}</p>}</div> : <div className="overflow-y-auto p-5">{entries.map((entry) => <div key={entry.voucherNo} className="p-3 border-b border-border flex justify-between gap-3"><div><div className="font-medium">{entry.vendor} — ₹{entry.amount}</div><div className="text-xs text-muted-foreground">{entry.voucherNo} · {entry.series}</div></div><div className="flex gap-3"><button className="text-primary" onClick={() => void openVoucherPDF([voucherEntryToPDFEntry(entry)])} aria-label="Regenerate voucher"><Download size={16} /></button><button className="text-destructive" onClick={() => void deleteVoucher(entry)} aria-label="Delete voucher"><Trash2 size={16} /></button></div></div>)}</div>}
  </div>;
}
