import { useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

const SERIES = ["VCH1", "VCH2"] as const;

export default function SeriesSetup({ ownerId, onComplete }: { ownerId: string; onComplete: (series: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function claim(series: string) {
    setBusy(true); setError("");
    try {
      await setDoc(doc(db, "deviceRegistry", series), { ownerId, claimedAt: serverTimestamp() });
      localStorage.setItem("voucher-series", series);
      onComplete(series);
    } catch {
      setError("Could not claim this series. Check your connection and try again.");
    } finally { setBusy(false); }
  }
  return <div className="min-h-full flex flex-col justify-center p-6 bg-background max-w-md mx-auto">
    <h1 className="text-2xl font-semibold text-foreground">Choose device series</h1>
    <p className="mt-2 text-sm text-muted-foreground">Choose this once. It keeps voucher numbers unique across devices.</p>
    <div className="mt-6 grid grid-cols-2 gap-3">{SERIES.map((series) => <button key={series} disabled={busy} onClick={() => void claim(series)} className="h-16 rounded-2xl bg-primary text-white font-semibold disabled:opacity-50">{series}</button>)}</div>
    {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
  </div>;
}
