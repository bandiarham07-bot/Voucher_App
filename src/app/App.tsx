import { useState, useEffect, useRef, useCallback } from "react";
import { Receipt, Database, Clock, Plus, Trash2, Pencil, Check, X, Search, ChevronDown, Settings as SettingsIcon, Download, RefreshCw } from "lucide-react";
import { Toaster, toast } from "sonner";
import { initAppData, setItem } from "../lib/db";
import { openVoucherPDF, voucherEntryToPDFEntry } from "../lib/pdf";
import { ensureSignedIn } from "../lib/firebase";
import { addMasterData, deleteMasterData, editMasterData, subscribeMasterData } from "../lib/masterDataSync";
import { deleteVoucher as deleteRemoteVoucher, subscribeOwnVouchers, upsertVoucher } from "../lib/voucherSync";
import SeriesSetup from "./SeriesSetup";
import Admin from "./Admin";
import type { PaymentType, Tab, VoucherEntry, VoucherLineItem } from "./types";
import { DEFAULT_SPLIT_THRESHOLD, SPLIT_TRIGGER_AMOUNT } from "./types";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatIndianInteger(n: string): string {
  if (!n) return "";
  if (n.length <= 3) return n;
  const last3 = n.slice(-3);
  const rest = n.slice(0, -3);
  const restFormatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return restFormatted + "," + last3;
}

function amountToNumber(formatted: string): number {
  return parseFloat(formatted.replace(/,/g, "")) || 0;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDisplayDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function maxVoucherNum(history: VoucherEntry[], series: string): number {
  return history.reduce((acc, r) => {
    if (r.series !== series && !r.voucherNo.startsWith(`${series}-`)) return acc;
    const n = parseInt(r.voucherNo.split("-").pop() ?? "0") || 0;
    return Math.max(acc, n);
  }, 0);
}

function voucherNoFromNum(n: number, series: string): string {
  return `${series}-${String(n).padStart(4, "0")}`;
}

function normalizeLineItems(entry: VoucherEntry): VoucherLineItem[] {
  return entry.lineItems?.length ? entry.lineItems : [{ account: entry.account, amount: entry.amount, remarks: entry.remarks }];
}

function sumLineItems(lines: VoucherLineItem[]): number {
  return Math.round(lines.reduce((acc, line) => acc + line.amount, 0) * 100) / 100;
}

function splitLineItems(lines: VoucherLineItem[], maxReceiptAmount: number): VoucherLineItem[][] {
  const receipts: VoucherLineItem[][] = [];
  let current: VoucherLineItem[] = [];
  let currentTotal = 0;

  for (const line of lines) {
    let remaining = Math.round(line.amount * 100) / 100;
    while (remaining > 0) {
      const room = Math.max(0, maxReceiptAmount - currentTotal);
      if (room <= 0) {
        receipts.push(current);
        current = [];
        currentTotal = 0;
        continue;
      }
      const take = Math.round(Math.min(remaining, room) * 100) / 100;
      current.push({ ...line, amount: take });
      currentTotal = Math.round((currentTotal + take) * 100) / 100;
      remaining = Math.round((remaining - take) * 100) / 100;
      if (remaining > 0) {
        receipts.push(current);
        current = [];
        currentTotal = 0;
      }
    }
  }

  if (current.length) receipts.push(current);
  return receipts;
}

function handleAmountInput(raw: string): string {
  const digitsAndDot = raw.replace(/[^0-9.]/g, "");
  const parts = digitsAndDot.split(".");
  const intPart = parts[0];
  const decPart = parts.length > 1 ? parts[1] : null;
  return formatIndianInteger(intPart) + (decPart !== null ? "." + decPart : "");
}

/** Generates (or regenerates) the PDF for a set of already-saved entries.
 *  Used both right after creating a receipt and from the Regenerate buttons in History,
 *  so retrying a failed PDF never re-saves or duplicates anything — it only re-renders. */
async function regenerateVoucherPDF(entries: VoucherEntry[]): Promise<void> {
  if (!entries.length) return;
  try {
    const { failed } = await openVoucherPDF(entries.map(voucherEntryToPDFEntry));
    if (failed.length === 0) {
      toast.success(entries.length > 1 ? `${entries.length} receipts generated` : `Receipt ${entries[0].voucherNo} generated`);
    } else {
      toast.warning(
        `${entries.length - failed.length} of ${entries.length} receipts generated. Missing: ${failed.map((f) => f.voucherNo).join(", ")}`,
        { action: { label: "Retry", onClick: () => { void regenerateVoucherPDF(entries); } } },
      );
    }
  } catch (err) {
    console.error("Voucher PDF generation failed", err);
    toast.error("Could not create the PDF. Your receipt is safely saved — try again anytime.", {
      action: { label: "Retry", onClick: () => { void regenerateVoucherPDF(entries); } },
    });
  }
}

// ── SearchableDropdown ─────────────────────────────────────────────────────

function SearchableDropdown({
  placeholder,
  options,
  value,
  onChange,
  onAddNew,
  addLabel,
  compact = false,
}: {
  placeholder: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  onAddNew: (v: string) => void;
  addLabel: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));
  const showAdd = query.trim() && !options.some((o) => o.toLowerCase() === query.trim().toLowerCase());

  function select(opt: string) {
    onChange(opt);
    setQuery(opt);
    setOpen(false);
  }

  function handleAdd() {
    const t = query.trim();
    if (t) { onAddNew(t); select(t); }
  }

  const height = compact ? "h-12" : "h-14";
  const px = compact ? "px-3" : "px-4";

  return (
    <div ref={ref} className="relative">
      <div className={`flex items-center ${height} bg-muted rounded-2xl ${px} gap-2 transition-all duration-150 focus-within:ring-2 focus-within:ring-primary/40`}>
        <input
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className={`flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground ${compact ? "text-sm" : "text-base"}`}
        />
        <ChevronDown size={15} className="text-muted-foreground shrink-0" />
      </div>
      {open && (filtered.length > 0 || showAdd) && (
        <div className="absolute z-50 top-[calc(100%+6px)] left-0 right-0 bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.13)] border border-border overflow-hidden">
          {filtered.map((opt) => (
            <button
              key={opt}
              onMouseDown={() => select(opt)}
              className="w-full text-left px-4 py-3.5 text-sm text-foreground hover:bg-muted active:bg-muted transition-colors border-b border-border last:border-0"
            >
              {opt}
            </button>
          ))}
          {showAdd && (
            <button
              onMouseDown={handleAdd}
              className="w-full text-left px-4 py-3.5 text-sm text-primary font-medium hover:bg-accent active:bg-accent transition-colors flex items-center gap-2"
            >
              <Plus size={13} />
              {addLabel} &ldquo;{query.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentTypeToggle({ value, onChange }: { value: PaymentType; onChange: (d: PaymentType) => void }) {
  return (
    <div className="flex bg-muted rounded-2xl p-1 gap-1">
      {(["नगदी", "चेक", "ऑनलाइन"] as PaymentType[]).map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all duration-150 active:scale-[0.97] ${
            value === d
              ? "bg-white text-primary shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
              : "text-muted-foreground"
          }`}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

// ── Split Confirm Modal ────────────────────────────────────────────────────

function SplitConfirmModal({
  groups,
  startNum,
  series,
  initialHaste,
  onConfirm,
  onCancel,
}: {
  groups: VoucherLineItem[][];
  startNum: number;
  series: string;
  initialHaste: string;
  onConfirm: (hasteByGroup: string[]) => void;
  onCancel: () => void;
}) {
  const [hasteByGroup, setHasteByGroup] = useState(() => groups.map(() => initialHaste));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-[2px]" onClick={onCancel}>
      <div
        className="bg-white w-full max-w-sm mx-4 mb-8 rounded-2xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4">
          <div className="font-semibold text-foreground mb-1 text-center">Split into {groups.length} receipts</div>
          <div className="text-muted-foreground text-sm text-center mb-4">
            Total exceeds the split threshold and will be generated as separate receipts.
          </div>
          <div className="bg-muted rounded-xl overflow-hidden">
            {groups.map((lines, i) => {
              const amt = sumLineItems(lines);
              return (
              <div
                key={i}
                className={`px-4 py-3 text-sm ${i < groups.length - 1 ? "border-b border-border" : ""}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground font-medium">{voucherNoFromNum(startNum + i, series)}</span>
                  <span className="text-foreground">₹{formatINR(amt)}</span>
                </div>
                <div className="text-muted-foreground text-xs mt-1 leading-relaxed">
                  {lines.map((line) => `₹${formatINR(line.amount)} from ${line.account}`).join(" · ")}
                </div>
                <input value={hasteByGroup[i]} onChange={(e) => setHasteByGroup((values) => values.map((value, index) => index === i ? e.target.value : value))} placeholder="Haste" className="mt-2 h-9 w-full rounded-lg bg-white px-2 text-sm outline-none" />
              </div>
            )})}
          </div>
        </div>
        <div className="border-t border-border flex">
          <button onClick={onCancel} className="flex-1 h-12 text-foreground font-medium border-r border-border active:bg-muted transition-colors">Cancel</button>
          <button onClick={() => onConfirm(hasteByGroup)} className="flex-1 h-12 text-primary font-semibold active:bg-muted transition-colors">Confirm & Generate All</button>
        </div>
      </div>
    </div>
  );
}

// ── Settings Modal ─────────────────────────────────────────────────────────

function SettingsModal({
  threshold,
  onSave,
  onAdmin,
  onCancel,
}: {
  threshold: number;
  onSave: (v: number) => void;
  onAdmin: () => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(String(threshold));

  function handleSave() {
    const n = parseFloat(val);
    if (n > 0) onSave(n);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-[2px]" onClick={onCancel}>
      <div
        className="bg-white w-full max-w-sm mx-4 mb-8 rounded-2xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-5">
          <div className="font-semibold text-foreground mb-1">Split Threshold</div>
          <div className="text-muted-foreground text-sm mb-4">
            Vouchers above this amount will be auto-split into smaller pieces.
          </div>
          <div className="flex items-center h-14 bg-muted rounded-2xl px-4 gap-2 focus-within:ring-2 focus-within:ring-primary/40">
            <span className="text-foreground font-medium select-none">₹</span>
            <input
              inputMode="decimal"
              value={val}
              onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, ""))}
              className="flex-1 bg-transparent outline-none text-foreground text-base"
            />
          </div>
          <button onClick={onAdmin} className="mt-4 w-full h-11 rounded-xl border border-border text-sm font-semibold text-primary">Admin</button>
        </div>
        <div className="border-t border-border flex">
          <button onClick={onCancel} className="flex-1 h-12 text-foreground font-medium border-r border-border active:bg-muted transition-colors">Cancel</button>
          <button onClick={handleSave} className="flex-1 h-12 text-primary font-semibold active:bg-muted transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Generate Voucher Tab ───────────────────────────────────────────────────

function GenerateTab({
  vendors,
  accounts,
  onAddVendor,
  onAddAccount,
  history,
  threshold,
  series,
  onSaveMany,
}: {
  vendors: string[];
  accounts: string[];
  onAddVendor: (v: string) => void;
  onAddAccount: (v: string) => void;
  history: VoucherEntry[];
  threshold: number;
  series: string;
  onSaveMany: (entries: VoucherEntry[]) => void;
}) {
  const [vendor, setVendor] = useState("");
  const [haste, setHaste] = useState("");
  const [remarks, setRemarks] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("नगदी");
  const [bankName, setBankName] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [lineRows, setLineRows] = useState([{ account: "", amountRaw: "", remarks: "" }]);
  const [date, setDate] = useState(todayISO());
  const [pendingSplit, setPendingSplit] = useState<{ groups: VoucherLineItem[][]; startNum: number } | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const totalAmount = sumLineItems(lineRows.map((line) => ({ account: line.account, amount: amountToNumber(line.amountRaw), remarks: line.remarks })));

  function buildEntries(groups: VoucherLineItem[][], hasteByGroup?: string[]): VoucherEntry[] {
    const startNum = maxVoucherNum(history, series) + 1;
    const groupId = groups.length > 1 ? Date.now() : undefined;
    return groups.map((lines, i) => ({
      id: Date.now() + i,
      vendor,
      amount: sumLineItems(lines),
      account: lines.map((line) => line.account).join(", "),
      lineItems: lines,
      haste: hasteByGroup?.[i] ?? haste,
      remarks,
      paymentType,
      bankName: paymentType === "चेक" ? bankName : "",
      chequeNo: paymentType === "चेक" ? chequeNo : "",
      date,
      voucherNo: voucherNoFromNum(startNum + i, series),
      series,
      ...(groups.length > 1 ? { splitGroup: { index: i + 1, total: groups.length, groupId } } : {}),
    }));
  }

  function resetForm() {
    setVendor("");
    setHaste("");
    setRemarks("");
    setPaymentType("नगदी");
    setBankName("");
    setChequeNo("");
    setLineRows([{ account: "", amountRaw: "", remarks: "" }]);
    setDate(todayISO());
  }

  async function finalize(groups: VoucherLineItem[][], hasteByGroup?: string[]) {
    const entries = buildEntries(groups, hasteByGroup);
    onSaveMany(entries);
    await regenerateVoucherPDF(entries);
    resetForm();
  }

  function handleSubmit() {
    if (!vendor.trim()) { toast.error("Please select a parivar"); return; }
    const lines = lineRows
      .map((line) => ({ account: line.account.trim(), amount: amountToNumber(line.amountRaw), remarks: line.remarks.trim() }))
      .filter((line) => line.account || line.amount > 0 || line.remarks);
    if (!lines.length || lines.some((line) => !line.account || line.amount <= 0)) {
      toast.error("Please complete every account row");
      return;
    }
    const accountsUsed = lines.map((line) => line.account.toLowerCase());
    if (new Set(accountsUsed).size !== accountsUsed.length) {
      toast.error("Duplicate accounts are not allowed in one receipt");
      return;
    }
    if (paymentType === "चेक" && (!bankName.trim() || !chequeNo.trim())) {
      toast.error("Please enter bank name and cheque no.");
      return;
    }

    const groups = totalAmount > SPLIT_TRIGGER_AMOUNT ? splitLineItems(lines, threshold) : [lines];

    if (groups.length > 1) {
      setPendingSplit({ groups, startNum: maxVoucherNum(history, series) + 1 });
    } else {
      finalize(groups);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-5 pt-6 pb-4">
      <SearchableDropdown
        placeholder="Parivar"
        options={vendors}
        value={vendor}
        onChange={setVendor}
        onAddNew={onAddVendor}
        addLabel="Add parivar"
      />

      <div className="flex items-center h-14 bg-muted rounded-2xl px-4 transition-all duration-150 focus-within:ring-2 focus-within:ring-primary/40">
        <input
          placeholder="हस्ते (optional)"
          value={haste}
          onChange={(e) => setHaste(e.target.value)}
          className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-base"
        />
      </div>

      <div className="flex items-center h-14 bg-muted rounded-2xl px-4 transition-all duration-150 focus-within:ring-2 focus-within:ring-primary/40">
        <input
          placeholder="Remarks"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-base"
        />
      </div>

      <PaymentTypeToggle value={paymentType} onChange={setPaymentType} />

      {paymentType === "चेक" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center h-14 bg-muted rounded-2xl px-4 focus-within:ring-2 focus-within:ring-primary/40">
            <input placeholder="Bank Name" value={bankName} onChange={(e) => setBankName(e.target.value)} className="w-full bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-base" />
          </div>
          <div className="flex items-center h-14 bg-muted rounded-2xl px-4 focus-within:ring-2 focus-within:ring-primary/40">
            <input placeholder="Cheque No" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} className="w-full bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-base" />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {lineRows.map((line, idx) => {
          const used = new Set(lineRows.map((row, rowIdx) => rowIdx === idx ? "" : row.account).filter(Boolean));
          return (
            <div key={idx} className="bg-white border border-border rounded-2xl p-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <SearchableDropdown
                    compact
                    placeholder="Account"
                    options={accounts.filter((account) => !used.has(account) || account === line.account)}
                    value={line.account}
                    onChange={(account) => setLineRows((rows) => rows.map((row, rowIdx) => rowIdx === idx ? { ...row, account } : row))}
                    onAddNew={onAddAccount}
                    addLabel="Add account"
                  />
                </div>
                <button
                  onClick={() => setLineRows((rows) => rows.length > 1 ? rows.filter((_, rowIdx) => rowIdx !== idx) : rows)}
                  className="w-12 h-12 rounded-xl bg-muted text-destructive flex items-center justify-center active:scale-[0.97]"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="flex items-center h-12 bg-muted rounded-xl px-3 gap-2 focus-within:ring-2 focus-within:ring-primary/40">
                <span className="text-foreground font-medium select-none text-sm">₹</span>
                <input
                  placeholder="Amount"
                  value={line.amountRaw}
                  inputMode="decimal"
                  onChange={(e) => setLineRows((rows) => rows.map((row, rowIdx) => rowIdx === idx ? { ...row, amountRaw: handleAmountInput(e.target.value) } : row))}
                  className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm"
                />
              </div>
              <div className="flex items-center h-12 bg-muted rounded-xl px-3 focus-within:ring-2 focus-within:ring-primary/40">
                <input
                  placeholder="Line remarks"
                  value={line.remarks}
                  onChange={(e) => setLineRows((rows) => rows.map((row, rowIdx) => rowIdx === idx ? { ...row, remarks: e.target.value } : row))}
                  className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm"
                />
              </div>
            </div>
          );
        })}
        <button
          onClick={() => setLineRows((rows) => [...rows, { account: "", amountRaw: "", remarks: "" }])}
          className="h-11 rounded-xl border border-dashed border-primary/50 text-primary text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.97]"
        >
          <Plus size={15} /> Add account row
        </button>
        <div className="flex items-center justify-between px-1 text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold text-foreground">₹{formatINR(totalAmount)}</span>
        </div>
      </div>

      <div
        className="flex items-center h-14 bg-muted rounded-2xl px-4 cursor-pointer relative"
        onClick={() => dateInputRef.current?.showPicker?.()}
      >
        <span className={date ? "text-foreground text-base" : "text-muted-foreground text-base"}>
          {date ? formatDisplayDate(date) : "Date"}
        </span>
        <input
          ref={dateInputRef}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full"
        />
      </div>

      <div className="mt-2">
        <button
          onClick={handleSubmit}
          className="w-full h-14 bg-primary text-primary-foreground rounded-2xl font-semibold text-base active:scale-[0.97] transition-transform duration-100 shadow-[0_2px_12px_rgba(0,122,255,0.28)]"
        >
          Generate Receipt
        </button>
      </div>

      {pendingSplit && (
        <SplitConfirmModal
          groups={pendingSplit.groups}
          startNum={pendingSplit.startNum}
          series={series}
          initialHaste={haste}
          onConfirm={(hasteByGroup) => { void finalize(pendingSplit.groups, hasteByGroup); setPendingSplit(null); }}
          onCancel={() => setPendingSplit(null)}
        />
      )}
    </div>
  );
}

// ── Master Data Tab ────────────────────────────────────────────────────────

function ListSection({
  title,
  items,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string;
  items: string[];
  onAdd: (v: string) => void;
  onEdit: (idx: number, v: string) => void;
  onDelete: (idx: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (adding) addRef.current?.focus(); }, [adding]);
  useEffect(() => { if (editIdx !== null) editRef.current?.focus(); }, [editIdx]);

  function commitAdd() {
    if (newVal.trim()) onAdd(newVal.trim());
    setNewVal(""); setAdding(false);
  }

  function commitEdit() {
    if (editIdx !== null && editVal.trim()) onEdit(editIdx, editVal.trim());
    setEditIdx(null); setEditVal("");
  }

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between px-1 mb-2.5">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
        <button
          onClick={() => { setAdding(true); setEditIdx(null); }}
          className="w-7 h-7 rounded-full bg-primary flex items-center justify-center active:scale-90 transition-transform duration-100"
        >
          <Plus size={14} className="text-white" />
        </button>
      </div>
      <div className="bg-white rounded-2xl border border-border overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        {items.length === 0 && !adding && (
          <div className="px-4 py-5 text-muted-foreground text-sm text-center">No entries — tap + to add</div>
        )}
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2 px-4 h-14 border-b border-border last:border-0">
            {editIdx === idx ? (
              <>
                <input
                  ref={editRef}
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditIdx(null); }}
                  className="flex-1 bg-transparent outline-none text-foreground text-base"
                />
                <button onClick={commitEdit} className="text-primary p-1 active:scale-90 transition-transform duration-100"><Check size={16} /></button>
                <button onClick={() => setEditIdx(null)} className="text-muted-foreground p-1 active:scale-90 transition-transform duration-100"><X size={16} /></button>
              </>
            ) : (
              <>
                <span className="flex-1 text-foreground text-base">{item}</span>
                <button
                  onClick={() => { setEditIdx(idx); setEditVal(item); setAdding(false); }}
                  className="text-muted-foreground hover:text-primary p-1 active:scale-90 transition-all duration-100"
                >
                  <Pencil size={15} />
                </button>
                <button onClick={() => onDelete(idx)} className="text-destructive p-1 active:scale-90 transition-transform duration-100">
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        ))}
        {adding && (
          <div className="flex items-center gap-2 px-4 h-14 border-t border-border">
            <input
              ref={addRef}
              placeholder="New entry…"
              value={newVal}
              onChange={(e) => setNewVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") setAdding(false); }}
              className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-base"
            />
            <button onClick={commitAdd} className="text-primary p-1 active:scale-90 transition-transform duration-100"><Check size={16} /></button>
            <button onClick={() => setAdding(false)} className="text-muted-foreground p-1 active:scale-90 transition-transform duration-100"><X size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function MasterTab({
  vendors, accounts,
  onAddVendor, onEditVendor, onDeleteVendor,
  onAddAccount, onEditAccount, onDeleteAccount,
}: {
  vendors: string[]; accounts: string[];
  onAddVendor: (v: string) => void; onEditVendor: (i: number, v: string) => void; onDeleteVendor: (i: number) => void;
  onAddAccount: (v: string) => void; onEditAccount: (i: number, v: string) => void; onDeleteAccount: (i: number) => void;
}) {
  return (
    <div className="px-5 pt-6 pb-4">
      <ListSection title="Parivars" items={vendors} onAdd={onAddVendor} onEdit={onEditVendor} onDelete={onDeleteVendor} />
      <ListSection title="Accounts" items={accounts} onAdd={onAddAccount} onEdit={onEditAccount} onDelete={onDeleteAccount} />
    </div>
  );
}

// ── Edit Row (inline in History) ───────────────────────────────────────────

function EditRow({
  entry, vendors, accounts,
  onCommit, onCancel,
}: {
  entry: VoucherEntry; vendors: string[]; accounts: string[];
  onCommit: (patch: Partial<VoucherEntry>) => void;
  onCancel: () => void;
}) {
  const [vendor, setVendor] = useState(entry.vendor);
  const [haste, setHaste] = useState(entry.haste ?? "");
  const [remarks, setRemarks] = useState(entry.remarks ?? "");
  const [paymentType, setPaymentType] = useState<PaymentType>(entry.paymentType ?? "नगदी");
  const [bankName, setBankName] = useState(entry.bankName ?? "");
  const [chequeNo, setChequeNo] = useState(entry.chequeNo ?? "");
  const [lineRows, setLineRows] = useState(() => normalizeLineItems(entry).map((line) => ({
    account: line.account,
    remarks: line.remarks ?? "",
    amountRaw: formatIndianInteger(String(Math.floor(line.amount))) + (line.amount % 1 !== 0 ? "." + line.amount.toFixed(2).split(".")[1] : ""),
  })));
  const [date, setDate] = useState(entry.date);
  const dateRef = useRef<HTMLInputElement>(null);
  const lines = lineRows.map((line) => ({ account: line.account, amount: amountToNumber(line.amountRaw), remarks: line.remarks }));
  const amount = sumLineItems(lines);

  return (
    <div className="px-4 py-3 bg-accent/40 flex flex-col gap-2.5">
      <SearchableDropdown compact placeholder="Parivar" options={vendors} value={vendor} onChange={setVendor} onAddNew={(v) => setVendor(v)} addLabel="Add parivar" />
      <input className="h-12 bg-muted rounded-xl px-3 outline-none text-sm" placeholder="हस्ते" value={haste} onChange={(e) => setHaste(e.target.value)} />
      <input className="h-12 bg-muted rounded-xl px-3 outline-none text-sm" placeholder="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      <PaymentTypeToggle value={paymentType} onChange={setPaymentType} />
      {paymentType === "चेक" && (
        <div className="grid grid-cols-2 gap-2">
          <input className="h-12 bg-muted rounded-xl px-3 outline-none text-sm" placeholder="Bank Name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          <input className="h-12 bg-muted rounded-xl px-3 outline-none text-sm" placeholder="Cheque No" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
        </div>
      )}
      {lineRows.map((line, idx) => (
        <div key={idx} className="flex flex-col gap-2 rounded-xl bg-white/70 p-2">
          <SearchableDropdown compact placeholder="Account" options={accounts} value={line.account} onChange={(account) => setLineRows((rows) => rows.map((row, rowIdx) => rowIdx === idx ? { ...row, account } : row))} onAddNew={(v) => setLineRows((rows) => rows.map((row, rowIdx) => rowIdx === idx ? { ...row, account: v } : row))} addLabel="Add account" />
          <div className="flex gap-2">
            <div className="flex flex-1 items-center h-12 bg-muted rounded-xl px-3 gap-2 focus-within:ring-2 focus-within:ring-primary/40">
              <span className="text-foreground font-medium select-none text-sm">₹</span>
              <input value={line.amountRaw} inputMode="decimal" onChange={(e) => setLineRows((rows) => rows.map((row, rowIdx) => rowIdx === idx ? { ...row, amountRaw: handleAmountInput(e.target.value) } : row))} className="flex-1 bg-transparent outline-none text-foreground text-sm" />
            </div>
            <button onClick={() => setLineRows((rows) => rows.length > 1 ? rows.filter((_, rowIdx) => rowIdx !== idx) : rows)} className="w-12 h-12 rounded-xl bg-muted text-destructive flex items-center justify-center"><Trash2 size={14} /></button>
          </div>
          <input className="h-12 bg-muted rounded-xl px-3 outline-none text-sm" placeholder="Line remarks" value={line.remarks} onChange={(e) => setLineRows((rows) => rows.map((row, rowIdx) => rowIdx === idx ? { ...row, remarks: e.target.value } : row))} />
        </div>
      ))}
      <button onClick={() => setLineRows((rows) => [...rows, { account: "", amountRaw: "", remarks: "" }])} className="h-10 rounded-xl border border-dashed border-primary/50 text-primary text-sm font-semibold">Add account row</button>
      <div className="flex justify-between text-sm px-1"><span className="text-muted-foreground">Total</span><span className="font-semibold">₹{formatINR(amount)}</span></div>
      <div
        className="flex items-center h-12 bg-muted rounded-xl px-3 cursor-pointer relative"
        onClick={() => dateRef.current?.showPicker?.()}
      >
        <span className="text-foreground text-sm">{date ? formatDisplayDate(date) : "Date"}</span>
        <input ref={dateRef} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onCommit({ vendor, amount, account: lines.map((line) => line.account).join(", "), lineItems: lines, haste, remarks, paymentType, bankName: paymentType === "चेक" ? bankName : "", chequeNo: paymentType === "चेक" ? chequeNo : "", date })}
          className="flex-1 h-10 bg-primary text-white rounded-xl text-sm font-semibold active:scale-[0.97] transition-transform duration-100"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="flex-1 h-10 bg-muted text-muted-foreground rounded-xl text-sm font-medium active:scale-[0.97] transition-transform duration-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Delete Confirm Modal ───────────────────────────────────────────────────

function DeleteConfirmModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-[2px]" onClick={onCancel}>
      <div
        className="bg-white w-full max-w-sm mx-4 mb-8 rounded-2xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="font-semibold text-foreground mb-1">Delete Receipt?</div>
          <div className="text-muted-foreground text-sm">This cannot be undone.</div>
        </div>
        <div className="border-t border-border flex">
          <button onClick={onCancel} className="flex-1 h-12 text-foreground font-medium border-r border-border active:bg-muted transition-colors">Cancel</button>
          <button onClick={onConfirm} className="flex-1 h-12 text-destructive font-semibold active:bg-muted transition-colors">Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── Voucher History Tab ────────────────────────────────────────────────────

function HistoryTab({
  history, vendors, accounts, onEdit, onDelete,
}: {
  history: VoucherEntry[];
  vendors: string[];
  accounts: string[];
  onEdit: (id: number, patch: Partial<VoucherEntry>) => void;
  onDelete: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);

  async function handleRegenerate(key: string, entries: VoucherEntry[]) {
    setRegeneratingKey(key);
    try {
      await regenerateVoucherPDF(entries);
    } finally {
      setRegeneratingKey(null);
    }
  }

  const historyItems = [...history].reverse().reduce<{
    key: string;
    entries: VoucherEntry[];
    total: number;
    lineCount: number;
    isGroup: boolean;
  }[]>((items, entry) => {
    const groupId = entry.splitGroup?.groupId;
    const key = groupId ? `group-${groupId}` : `entry-${entry.id}`;
    if (items.some((item) => item.key === key)) return items;
    const entries = groupId
      ? history.filter((candidate) => candidate.splitGroup?.groupId === groupId).sort((a, b) => (a.splitGroup?.index ?? 0) - (b.splitGroup?.index ?? 0))
      : [entry];
    const total = sumLineItems(entries.flatMap(normalizeLineItems));
    const lineCount = entries.reduce((acc, receipt) => acc + normalizeLineItems(receipt).length, 0);
    items.push({ key, entries, total, lineCount, isGroup: entries.length > 1 });
    return items;
  }, []).filter((item) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const entry = item.entries[0];
    return entry.vendor.toLowerCase().includes(q) || entry.date.includes(q) || formatDisplayDate(entry.date).toLowerCase().includes(q);
  });

  function startEdit(entry: VoucherEntry) {
    setEditingId(entry.id);
    setExpandedId(null);
  }

  function handleDelete(id: number) {
    onDelete(id);
    setDeleteId(null);
    setExpandedId(null);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center h-11 bg-muted rounded-xl px-3 gap-2 focus-within:ring-2 focus-within:ring-primary/40">
          <Search size={15} className="text-muted-foreground shrink-0" />
          <input
            placeholder="Search parivar or date…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground active:scale-90 transition-transform duration-100">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {historyItems.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-12">
            {history.length === 0 ? "No receipts yet" : "No results found"}
          </div>
        )}
        {historyItems.length > 0 && (
          <div className="bg-white rounded-2xl border border-border overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            {historyItems.map((item, i) => {
              const entry = item.entries[0];
              return (
              <div key={item.key} className={i < historyItems.length - 1 ? "border-b border-border" : ""}>
                {editingId === entry.id ? (
                  <EditRow
                    entry={entry}
                    vendors={vendors}
                    accounts={accounts}
                    onCommit={(patch) => { onEdit(entry.id, patch); setEditingId(null); }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <button
                      className="w-full text-left px-4 py-4 active:bg-muted/60 transition-colors duration-100"
                      onClick={() => setExpandedId(expandedId === item.key ? null : item.key)}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-foreground text-[15px] truncate">{entry.vendor}</span>
                        <span className="text-foreground font-medium text-sm shrink-0">₹{formatINR(item.total)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-muted-foreground text-xs">
                          {item.isGroup ? `${item.entries[0].voucherNo} to ${item.entries[item.entries.length - 1].voucherNo}` : `${item.lineCount} line item${item.lineCount === 1 ? "" : "s"}`}
                        </span>
                        <span className="text-muted-foreground text-xs">{formatDisplayDate(entry.date)}</span>
                      </div>
                    </button>

                    {expandedId === item.key && (
                      <div className="px-4 pb-3.5 pt-2 bg-muted/40">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{item.isGroup ? `${item.entries.length} split receipts` : entry.voucherNo}</span>
                          <span>{entry.paymentType ?? "नगदी"}</span>
                        </div>
                        {item.isGroup && (
                          <button
                            onClick={() => handleRegenerate(item.key, item.entries)}
                            disabled={regeneratingKey === item.key}
                            className="mt-2 w-full h-9 rounded-xl bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform duration-100 disabled:opacity-50"
                          >
                            <RefreshCw size={12} className={regeneratingKey === item.key ? "animate-spin" : ""} />
                            {regeneratingKey === item.key ? "Generating…" : `Regenerate all ${item.entries.length} PDFs`}
                          </button>
                        )}
                        <div className="mt-2 flex flex-col gap-2">
                          {item.entries.map((receipt) => (
                            <div key={receipt.id} className="rounded-xl bg-white/70 overflow-hidden">
                              <div className="flex items-center justify-between px-3 py-2 text-xs border-b border-border">
                                <span className="font-mono text-muted-foreground">{receipt.voucherNo}</span>
                                <div className="flex items-center gap-3">
                                  <span className="font-semibold text-foreground">₹{formatINR(receipt.amount)}</span>
                                  <button
                                    onClick={() => handleRegenerate(`receipt-${receipt.id}`, [receipt])}
                                    disabled={regeneratingKey === `receipt-${receipt.id}`}
                                    className="text-primary active:scale-90 transition-transform duration-100 disabled:opacity-40"
                                    aria-label={`Regenerate PDF for ${receipt.voucherNo}`}
                                  >
                                    <Download size={12} />
                                  </button>
                                </div>
                              </div>
                              {normalizeLineItems(receipt).map((line, lineIdx) => (
                                <div key={lineIdx} className={`px-3 py-2 text-xs ${lineIdx > 0 ? "border-t border-border" : ""}`}>
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-foreground font-medium truncate">{line.account}</span>
                                    <span className="text-foreground shrink-0">₹{formatINR(line.amount)}</span>
                                  </div>
                                  {line.remarks && <div className="text-muted-foreground mt-0.5">{line.remarks}</div>}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                        {(entry.haste || entry.remarks || entry.bankName || entry.chequeNo) && (
                          <div className="mt-2 text-xs text-muted-foreground leading-relaxed">
                            {entry.haste && <div>हस्ते: {entry.haste}</div>}
                            {entry.remarks && <div>Remarks: {entry.remarks}</div>}
                            {entry.paymentType === "चेक" && <div>Cheque: {entry.chequeNo} · {entry.bankName}</div>}
                          </div>
                        )}
                        {!item.isGroup && (
                          <div className="flex gap-4 justify-end mt-3">
                            <button
                              onClick={() => handleRegenerate(`entry-${entry.id}`, [entry])}
                              disabled={regeneratingKey === `entry-${entry.id}`}
                              className="flex items-center gap-1.5 text-primary text-xs font-semibold active:scale-90 transition-transform duration-100 disabled:opacity-40"
                            >
                              <Download size={12} /> {regeneratingKey === `entry-${entry.id}` ? "Generating…" : "Regenerate"}
                            </button>
                            <button
                              onClick={() => startEdit(entry)}
                              className="flex items-center gap-1.5 text-primary text-xs font-semibold active:scale-90 transition-transform duration-100"
                            >
                              <Pencil size={12} /> Edit
                            </button>
                            <button
                              onClick={() => setDeleteId(entry.id)}
                              className="flex items-center gap-1.5 text-destructive text-xs font-semibold active:scale-90 transition-transform duration-100"
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )})}
          </div>
        )}
      </div>

      {deleteId !== null && (
        <DeleteConfirmModal
          onConfirm={() => handleDelete(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

// ── App Root ───────────────────────────────────────────────────────────────

export default function App() {
  const [ready, setReady] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [series, setSeries] = useState(() => localStorage.getItem("voucher-series") ?? "");
  const [activeTab, setActiveTab] = useState<Tab>("generate");
  const [vendors, setVendors] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const vendorIds = useRef<string[]>([]);
  const accountIds = useRef<string[]>([]);
  const [history, setHistory] = useState<VoucherEntry[]>([]);
  const [threshold, setThreshold] = useState<number>(DEFAULT_SPLIT_THRESHOLD);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    Promise.all([initAppData(), ensureSignedIn()])
      .then(([data, user]) => { setOwnerId(user.uid); setThreshold(data.splitThreshold); setReady(true); })
      .catch(() => {
        toast.error("Failed to connect to Firebase");
        setReady(true);
      });
  }, []);

  useEffect(() => { if (ready) setItem("splitThreshold", threshold); }, [ready, threshold]);
  useEffect(() => {
    if (!ownerId) return;
    const reportSyncError = () => toast.error("Could not load shared master data. Check Firebase rules and your connection.");
    const stopVendors = subscribeMasterData("vendors", (items) => { vendorIds.current = items.map((item) => item.id); setVendors(items.map((item) => item.name)); }, reportSyncError);
    const stopAccounts = subscribeMasterData("accounts", (items) => { accountIds.current = items.map((item) => item.id); setAccounts(items.map((item) => item.name)); }, reportSyncError);
    return () => { stopVendors(); stopAccounts(); };
  }, [ownerId]);
  useEffect(() => ownerId && series ? subscribeOwnVouchers(ownerId, setHistory, () => toast.error("Could not load voucher history. Check Firebase rules and your connection.")) : undefined, [ownerId, series]);

  const addVendor = useCallback((v: string) => { if (!vendors.some((item) => item.toLowerCase() === v.toLowerCase())) void addMasterData("vendors", v).catch(() => toast.error("Could not save parivar")); }, [vendors]);
  const editVendor = useCallback((i: number, v: string) => { if (vendorIds.current[i]) void editMasterData("vendors", vendorIds.current[i], v).catch(() => toast.error("Could not update parivar")); }, []);
  const deleteVendor = useCallback((i: number) => { if (vendorIds.current[i]) void deleteMasterData("vendors", vendorIds.current[i]).catch(() => toast.error("Could not delete parivar")); }, []);

  const addAccount = useCallback((v: string) => { if (!accounts.some((item) => item.toLowerCase() === v.toLowerCase())) void addMasterData("accounts", v).catch(() => toast.error("Could not save account")); }, [accounts]);
  const editAccount = useCallback((i: number, v: string) => { if (accountIds.current[i]) void editMasterData("accounts", accountIds.current[i], v).catch(() => toast.error("Could not update account")); }, []);
  const deleteAccount = useCallback((i: number) => { if (accountIds.current[i]) void deleteMasterData("accounts", accountIds.current[i]).catch(() => toast.error("Could not delete account")); }, []);

  const saveVouchers = useCallback((entries: VoucherEntry[]) => {
    if (!ownerId || !series) { toast.error("Firebase sign-in is still starting. Please try again."); return; }
    setHistory((current) => [...current, ...entries]);
    void Promise.all(entries.map((entry) => upsertVoucher(entry, ownerId, series))).catch(() => {
      setHistory((current) => current.filter((item) => !entries.some((entry) => entry.voucherNo === item.voucherNo)));
      toast.error("Voucher was not saved. Check Firebase rules and try again.");
    });
  }, [ownerId, series]);

  const editVoucher = useCallback((id: number, patch: Partial<VoucherEntry>) => {
    const remoteTarget = history.find((entry) => entry.id === id);
    if (remoteTarget && ownerId && series) void upsertVoucher({ ...remoteTarget, ...patch }, ownerId, series);
    setHistory((prev) => {
      const target = prev.find((r) => r.id === id);
      if (!target) return prev;
      const merged: VoucherEntry = { ...target, ...patch };

      if (merged.amount > SPLIT_TRIGGER_AMOUNT) {
        const groups = splitLineItems(normalizeLineItems(merged), threshold);
        if (groups.length > 1) {
          const withoutTarget = prev.filter((r) => r.id !== id);
          const startNum = maxVoucherNum(prev, series) + 1;
          const groupId = Date.now();
          const newEntries: VoucherEntry[] = groups.map((lines, i) => ({
            id: Date.now() + i,
            vendor: merged.vendor,
            amount: sumLineItems(lines),
            account: lines.map((line) => line.account).join(", "),
            lineItems: lines,
            haste: merged.haste,
            remarks: merged.remarks,
            paymentType: merged.paymentType ?? "नगदी",
            bankName: merged.bankName,
            chequeNo: merged.chequeNo,
            date: merged.date,
            voucherNo: voucherNoFromNum(startNum + i, series),
            splitGroup: { index: i + 1, total: groups.length, groupId },
          }));
          return [...withoutTarget, ...newEntries];
        }
      }

      return prev.map((r) => (r.id === id ? merged : r));
    });
  }, [history, ownerId, series, threshold]);

  const deleteVoucher = useCallback((id: number) => {
    const entry = history.find((item) => item.id === id);
    if (entry) void deleteRemoteVoucher(entry);
    setHistory((p) => p.filter((r) => r.id !== id));
  }, [history]);

  const tabTitles: Record<Tab, string> = {
    generate: "New Receipt",
    master: "Master Data",
    history: "Receipt History",
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (!series) return <SeriesSetup ownerId={ownerId} onComplete={setSeries} />;

  return (
    <div className="flex flex-col h-full bg-background max-w-md mx-auto relative overflow-hidden">
      <Toaster position="top-center" richColors />

      {/* Status bar spacer + header */}
      <div className="flex-shrink-0 bg-background px-5 pt-14 pb-3 border-b border-border flex items-center justify-between">
        <h1 className="text-[22px] font-semibold text-foreground tracking-tight">{tabTitles[activeTab]}</h1>
        <button
          onClick={() => setSettingsOpen(true)}
          className="text-muted-foreground active:scale-90 transition-transform duration-100 p-1"
        >
          <SettingsIcon size={20} />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {activeTab === "generate" && (
          <div className="flex-1 overflow-y-auto">
            <GenerateTab
              vendors={vendors}
              accounts={accounts}
              onAddVendor={addVendor}
              onAddAccount={addAccount}
              history={history}
              threshold={threshold}
              series={series}
              onSaveMany={saveVouchers}
            />
          </div>
        )}
        {activeTab === "master" && (
          <div className="flex-1 overflow-y-auto">
            <MasterTab
              vendors={vendors}
              accounts={accounts}
              onAddVendor={addVendor}
              onEditVendor={editVendor}
              onDeleteVendor={deleteVendor}
              onAddAccount={addAccount}
              onEditAccount={editAccount}
              onDeleteAccount={deleteAccount}
            />
          </div>
        )}
        {activeTab === "history" && (
          <HistoryTab
            history={history}
            vendors={vendors}
            accounts={accounts}
            onEdit={editVoucher}
            onDelete={deleteVoucher}
          />
        )}
      </div>

      {/* Bottom tab bar */}
      <div className="flex-shrink-0 bg-white/95 backdrop-blur-sm border-t border-border">
        <div className="flex">
          {(
            [
              { id: "generate" as Tab, label: "Generate", Icon: Receipt },
              { id: "master" as Tab, label: "Master Data", Icon: Database },
              { id: "history" as Tab, label: "History", Icon: Clock },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 active:scale-95 transition-transform duration-100 ${
                activeTab === id ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon size={22} />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          ))}
        </div>
        <div className="pb-1" />
      </div>

      {settingsOpen && (
        <SettingsModal
          threshold={threshold}
          onSave={(v) => { setThreshold(v); setSettingsOpen(false); }}
          onAdmin={() => { setSettingsOpen(false); setAdminOpen(true); }}
          onCancel={() => setSettingsOpen(false)}
        />
      )}
      {adminOpen && <Admin onClose={() => setAdminOpen(false)} />}
    </div>
  );
}
