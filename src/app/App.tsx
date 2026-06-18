import { useState, useEffect, useRef, useCallback } from "react";
import { Receipt, Database, Clock, Plus, Trash2, Pencil, Check, X, Search, ChevronDown, Settings as SettingsIcon } from "lucide-react";
import { Toaster, toast } from "sonner";
import { initAppData, setItem } from "../lib/db";
import { openVoucherPDF } from "../lib/pdf";
import type { Direction, Tab, VoucherEntry } from "./types";
import { DEFAULT_SPLIT_THRESHOLD } from "./types";

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

function directionLabel(direction: Direction): string {
  return direction === "paid" ? "Paid to" : "Received from";
}

function maxVoucherNum(history: VoucherEntry[]): number {
  return history.reduce((acc, r) => {
    const n = parseInt(r.voucherNo.replace("VCH-", "")) || 0;
    return Math.max(acc, n);
  }, 0);
}

function voucherNoFromNum(n: number): string {
  return "VCH-" + String(n).padStart(4, "0");
}

// Splits an amount into the minimum number of whole-rupee parts, each
// strictly under `threshold`. Any leftover paise is added entirely to the
// last piece so the total still matches exactly. Returns [amount] unchanged
// if it doesn't exceed the threshold.
function computeSplit(amount: number, threshold: number): number[] {
  if (amount <= threshold) return [amount];

  const totalPaiseInt = Math.round(amount * 100);
  const paise = totalPaiseInt % 100;
  const rupees = (totalPaiseInt - paise) / 100;

  const n = Math.ceil(rupees / (threshold - 1));
  const base = Math.floor(rupees / n);
  const remainder = rupees % n;

  const parts: number[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(base + (i < remainder ? 1 : 0));
  }

  if (paise > 0) {
    const lastIdx = parts.length - 1;
    parts[lastIdx] = Math.round((parts[lastIdx] + paise / 100) * 100) / 100;
  }

  return parts;
}

function handleAmountInput(raw: string): string {
  const digitsAndDot = raw.replace(/[^0-9.]/g, "");
  const parts = digitsAndDot.split(".");
  const intPart = parts[0];
  const decPart = parts.length > 1 ? parts[1] : null;
  return formatIndianInteger(intPart) + (decPart !== null ? "." + decPart : "");
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

// ── Direction Toggle ───────────────────────────────────────────────────────

function DirectionToggle({ value, onChange }: { value: Direction; onChange: (d: Direction) => void }) {
  return (
    <div className="flex bg-muted rounded-2xl p-1 gap-1">
      {(["received", "paid"] as Direction[]).map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all duration-150 active:scale-[0.97] ${
            value === d
              ? "bg-white text-primary shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
              : "text-muted-foreground"
          }`}
        >
          {d === "received" ? "Received from" : "Paid to"}
        </button>
      ))}
    </div>
  );
}

// ── Split Confirm Modal ────────────────────────────────────────────────────

function SplitConfirmModal({
  parts,
  startNum,
  onConfirm,
  onCancel,
}: {
  parts: number[];
  startNum: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-[2px]" onClick={onCancel}>
      <div
        className="bg-white w-full max-w-sm mx-4 mb-8 rounded-2xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4">
          <div className="font-semibold text-foreground mb-1 text-center">Split into {parts.length} vouchers</div>
          <div className="text-muted-foreground text-sm text-center mb-4">
            Amount exceeds the split threshold and will be generated as separate vouchers.
          </div>
          <div className="bg-muted rounded-xl overflow-hidden">
            {parts.map((amt, i) => (
              <div
                key={i}
                className={`flex items-center justify-between px-4 py-3 text-sm ${i < parts.length - 1 ? "border-b border-border" : ""}`}
              >
                <span className="text-foreground font-medium">{voucherNoFromNum(startNum + i)}</span>
                <span className="text-foreground">₹{formatINR(amt)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border flex">
          <button onClick={onCancel} className="flex-1 h-12 text-foreground font-medium border-r border-border active:bg-muted transition-colors">Cancel</button>
          <button onClick={onConfirm} className="flex-1 h-12 text-primary font-semibold active:bg-muted transition-colors">Confirm</button>
        </div>
      </div>
    </div>
  );
}

// ── Settings Modal ─────────────────────────────────────────────────────────

function SettingsModal({
  threshold,
  onSave,
  onCancel,
}: {
  threshold: number;
  onSave: (v: number) => void;
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
  onSaveMany,
}: {
  vendors: string[];
  accounts: string[];
  onAddVendor: (v: string) => void;
  onAddAccount: (v: string) => void;
  history: VoucherEntry[];
  threshold: number;
  onSaveMany: (entries: VoucherEntry[]) => void;
}) {
  const [direction, setDirection] = useState<Direction>("received");
  const [vendor, setVendor] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [pendingSplit, setPendingSplit] = useState<{ parts: number[]; startNum: number } | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  function buildEntries(parts: number[]): VoucherEntry[] {
    const startNum = maxVoucherNum(history) + 1;
    return parts.map((amt, i) => ({
      id: Date.now() + i,
      direction,
      vendor,
      amount: amt,
      account,
      date,
      voucherNo: voucherNoFromNum(startNum + i),
      ...(parts.length > 1 ? { splitGroup: { index: i + 1, total: parts.length } } : {}),
    }));
  }

  function resetForm() {
    setVendor("");
    setAmountRaw("");
    setAccount("");
    setDate(todayISO());
    setDirection("received");
  }

  async function finalize(parts: number[]) {
    const entries = buildEntries(parts);
    onSaveMany(entries);
    try {
      await openVoucherPDF(entries);
      toast.success(
        entries.length > 1 ? `${entries.length} vouchers generated` : `Voucher ${entries[0].voucherNo} generated`,
      );
    } catch {
      toast.error("Voucher saved, but PDF could not be created");
    }
    resetForm();
  }

  function handleSubmit() {
    if (!vendor.trim()) { toast.error("Please select a vendor"); return; }
    if (!amountRaw || amountToNumber(amountRaw) === 0) { toast.error("Please enter an amount"); return; }
    if (!account.trim()) { toast.error("Please select an account"); return; }

    const amount = amountToNumber(amountRaw);
    const parts = computeSplit(amount, threshold);

    if (parts.length > 1) {
      setPendingSplit({ parts, startNum: maxVoucherNum(history) + 1 });
    } else {
      finalize(parts);
    }
  }

  return (
    <div className="flex flex-col gap-4 px-5 pt-6 pb-4">
      <DirectionToggle value={direction} onChange={setDirection} />

      <SearchableDropdown
        placeholder="Vendor"
        options={vendors}
        value={vendor}
        onChange={setVendor}
        onAddNew={onAddVendor}
        addLabel="Add vendor"
      />

      <div className="flex items-center h-14 bg-muted rounded-2xl px-4 gap-2 transition-all duration-150 focus-within:ring-2 focus-within:ring-primary/40">
        <span className="text-foreground font-medium select-none">₹</span>
        <input
          placeholder="Amount"
          value={amountRaw}
          inputMode="decimal"
          onChange={(e) => setAmountRaw(handleAmountInput(e.target.value))}
          className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-base"
        />
      </div>

      <SearchableDropdown
        placeholder="Account"
        options={accounts}
        value={account}
        onChange={setAccount}
        onAddNew={onAddAccount}
        addLabel="Add account"
      />

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
          Generate Voucher
        </button>
      </div>

      {pendingSplit && (
        <SplitConfirmModal
          parts={pendingSplit.parts}
          startNum={pendingSplit.startNum}
          onConfirm={() => { finalize(pendingSplit.parts); setPendingSplit(null); }}
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
      <ListSection title="Vendors" items={vendors} onAdd={onAddVendor} onEdit={onEditVendor} onDelete={onDeleteVendor} />
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
  const [direction, setDirection] = useState<Direction>(entry.direction);
  const [vendor, setVendor] = useState(entry.vendor);
  const [amountRaw, setAmountRaw] = useState(() => {
    const n = entry.amount;
    const intPart = String(Math.floor(n));
    const dec = n % 1 !== 0 ? "." + n.toFixed(2).split(".")[1] : "";
    return formatIndianInteger(intPart) + dec;
  });
  const [account, setAccount] = useState(entry.account);
  const [date, setDate] = useState(entry.date);
  const dateRef = useRef<HTMLInputElement>(null);

  return (
    <div className="px-4 py-3 bg-accent/40 flex flex-col gap-2.5">
      <DirectionToggle value={direction} onChange={setDirection} />
      <SearchableDropdown compact placeholder="Vendor" options={vendors} value={vendor} onChange={setVendor} onAddNew={(v) => setVendor(v)} addLabel="Add vendor" />
      <div className="flex items-center h-12 bg-muted rounded-xl px-3 gap-2 focus-within:ring-2 focus-within:ring-primary/40">
        <span className="text-foreground font-medium select-none text-sm">₹</span>
        <input
          value={amountRaw}
          inputMode="decimal"
          onChange={(e) => setAmountRaw(handleAmountInput(e.target.value))}
          className="flex-1 bg-transparent outline-none text-foreground text-sm"
        />
      </div>
      <SearchableDropdown compact placeholder="Account" options={accounts} value={account} onChange={setAccount} onAddNew={(v) => setAccount(v)} addLabel="Add account" />
      <div
        className="flex items-center h-12 bg-muted rounded-xl px-3 cursor-pointer relative"
        onClick={() => dateRef.current?.showPicker?.()}
      >
        <span className="text-foreground text-sm">{date ? formatDisplayDate(date) : "Date"}</span>
        <input ref={dateRef} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onCommit({ direction, vendor, amount: amountToNumber(amountRaw), account, date })}
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
          <div className="font-semibold text-foreground mb-1">Delete Voucher?</div>
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const filtered = [...history].reverse().filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return r.vendor.toLowerCase().includes(q) || r.date.includes(q) || formatDisplayDate(r.date).toLowerCase().includes(q);
  });

  function startEdit(entry: VoucherEntry) {
    setEditingId(entry.id);
    setExpandedId(null);
  }

  function handleDelete(id: number) {
    onDelete(id);
    setDeleteId(null);
    if (expandedId === id) setExpandedId(null);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center h-11 bg-muted rounded-xl px-3 gap-2 focus-within:ring-2 focus-within:ring-primary/40">
          <Search size={15} className="text-muted-foreground shrink-0" />
          <input
            placeholder="Search vendor or date…"
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
        {filtered.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-12">
            {history.length === 0 ? "No vouchers yet" : "No results found"}
          </div>
        )}
        {filtered.length > 0 && (
          <div className="bg-white rounded-2xl border border-border overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            {filtered.map((entry, i) => (
              <div key={entry.id} className={i < filtered.length - 1 ? "border-b border-border" : ""}>
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
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-foreground text-[15px] truncate">{entry.vendor}</span>
                        <span className="text-foreground font-medium text-sm shrink-0">₹{formatINR(entry.amount)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-muted-foreground text-xs">{directionLabel(entry.direction)} · {entry.account}</span>
                        <span className="text-muted-foreground text-xs">{formatDisplayDate(entry.date)}</span>
                      </div>
                    </button>

                    {expandedId === entry.id && (
                      <div className="px-4 pb-3.5 pt-1 bg-muted/40 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-mono tracking-wide">{entry.voucherNo}</span>
                          {entry.splitGroup && (
                            <span className="text-[10px] font-medium text-primary bg-accent rounded-full px-2 py-0.5">
                              Split {entry.splitGroup.index} of {entry.splitGroup.total}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-4">
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
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
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
  const [activeTab, setActiveTab] = useState<Tab>("generate");
  const [vendors, setVendors] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [history, setHistory] = useState<VoucherEntry[]>([]);
  const [threshold, setThreshold] = useState<number>(DEFAULT_SPLIT_THRESHOLD);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    initAppData()
      .then((data) => {
        setVendors(data.vendors);
        setAccounts(data.accounts);
        setHistory(data.vouchers);
        setThreshold(data.splitThreshold);
        setReady(true);
      })
      .catch(() => {
        toast.error("Failed to load saved data");
        setReady(true);
      });
  }, []);

  useEffect(() => { if (ready) setItem("vendors", vendors); }, [ready, vendors]);
  useEffect(() => { if (ready) setItem("accounts", accounts); }, [ready, accounts]);
  useEffect(() => { if (ready) setItem("vouchers", history); }, [ready, history]);
  useEffect(() => { if (ready) setItem("splitThreshold", threshold); }, [ready, threshold]);

  const addVendor = useCallback((v: string) => setVendors((p) => p.includes(v) ? p : [...p, v]), []);
  const editVendor = useCallback((i: number, v: string) => setVendors((p) => p.map((x, idx) => idx === i ? v : x)), []);
  const deleteVendor = useCallback((i: number) => setVendors((p) => p.filter((_, idx) => idx !== i)), []);

  const addAccount = useCallback((v: string) => setAccounts((p) => p.includes(v) ? p : [...p, v]), []);
  const editAccount = useCallback((i: number, v: string) => setAccounts((p) => p.map((x, idx) => idx === i ? v : x)), []);
  const deleteAccount = useCallback((i: number) => setAccounts((p) => p.filter((_, idx) => idx !== i)), []);

  const saveVouchers = useCallback((entries: VoucherEntry[]) => setHistory((p) => [...p, ...entries]), []);

  const editVoucher = useCallback((id: number, patch: Partial<VoucherEntry>) => {
    setHistory((prev) => {
      const target = prev.find((r) => r.id === id);
      if (!target) return prev;
      const merged: VoucherEntry = { ...target, ...patch };

      if (merged.amount > threshold) {
        const parts = computeSplit(merged.amount, threshold);
        if (parts.length > 1) {
          const withoutTarget = prev.filter((r) => r.id !== id);
          const startNum = maxVoucherNum(prev) + 1;
          const newEntries: VoucherEntry[] = parts.map((amt, i) => ({
            id: Date.now() + i,
            direction: merged.direction,
            vendor: merged.vendor,
            amount: amt,
            account: merged.account,
            date: merged.date,
            voucherNo: voucherNoFromNum(startNum + i),
            splitGroup: { index: i + 1, total: parts.length },
          }));
          return [...withoutTarget, ...newEntries];
        }
      }

      return prev.map((r) => (r.id === id ? merged : r));
    });
  }, [threshold]);

  const deleteVoucher = useCallback((id: number) => setHistory((p) => p.filter((r) => r.id !== id)), []);

  const tabTitles: Record<Tab, string> = {
    generate: "New Voucher",
    master: "Master Data",
    history: "Voucher History",
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

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
          onCancel={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}