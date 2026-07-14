import { useState } from "react";

const DEFAULT_SERIES = ["VCH1", "VCH2", "VCH3", "VCH4", "VCH5"];

export default function SeriesSetup({ onComplete }: { onComplete: (series: string) => void }) {
  const [selected, setSelected] = useState(DEFAULT_SERIES[0]);
  const [customSeries, setCustomSeries] = useState("");
  const [error, setError] = useState("");

  function continueWithSeries() {
    const series = (customSeries.trim() || selected).toUpperCase().replace(/\s+/g, "-");
    if (!series) { setError("Select or enter a voucher series."); return; }
    localStorage.setItem("voucher-series", series);
    onComplete(series);
  }

  return <div className="min-h-full flex flex-col justify-center p-6 bg-background max-w-md mx-auto">
    <h1 className="text-2xl font-semibold text-foreground">Choose voucher series</h1>
    <p className="mt-2 text-sm text-muted-foreground">Any number of users can choose the same series. You can also add a new series name at any time.</p>
    <label className="mt-6 text-sm font-medium text-foreground">Voucher series</label>
    <select value={selected} onChange={(event) => { setSelected(event.target.value); setCustomSeries(""); }} className="mt-2 h-12 rounded-xl bg-muted px-3 text-foreground outline-none">
      {DEFAULT_SERIES.map((series) => <option key={series} value={series}>{series}</option>)}
    </select>
    <label className="mt-4 text-sm font-medium text-foreground">Or enter a new series</label>
    <input value={customSeries} onChange={(event) => setCustomSeries(event.target.value)} placeholder="Example: VCH6" className="mt-2 h-12 rounded-xl bg-muted px-3 text-foreground outline-none" />
    <button onClick={continueWithSeries} className="mt-6 h-12 rounded-xl bg-primary text-white font-semibold">Continue</button>
    {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
  </div>;
}
