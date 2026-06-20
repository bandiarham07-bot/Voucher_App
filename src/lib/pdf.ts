import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import type { PaymentType, VoucherEntry, VoucherLineItem } from "../app/types";

export interface VoucherPDFEntry {
  vendor: string;
  amount: number;
  account: string;
  lineItems?: VoucherLineItem[];
  haste?: string;
  remarks?: string;
  paymentType?: PaymentType;
  chequeNo?: string;
  bankName?: string;
  date: string;
  voucherNo: string;
}

/** Convert a stored history entry back into the shape the PDF builder expects.
 *  Used both for the initial generation and for regenerating from History. */
export function voucherEntryToPDFEntry(entry: VoucherEntry): VoucherPDFEntry {
  return {
    vendor: entry.vendor,
    amount: entry.amount,
    account: entry.account,
    lineItems: entry.lineItems,
    haste: entry.haste,
    remarks: entry.remarks,
    paymentType: entry.paymentType,
    chequeNo: entry.chequeNo,
    bankName: entry.bankName,
    date: entry.date,
    voucherNo: entry.voucherNo,
  };
}

const TRUST_DATA = {
  mangalacharana: "॥ श्री पार्श्वनाथाय नमः ॥",
  trustName: "श्री श्वेताम्बर जैन तपागच्छ उपाश्रय ट्रस्ट",
  office: "कार्यालय : 4/2, रेसकोर्स रोड, इन्दौर",
};

const HINDI = {
  serial: "क्रमांक:",
  receipt: "रसीद",
  date: "दिनांक:",
  shreeman: "श्रीमान:",
  haste: "हस्ते:",
  details: "विवरण",
  amount: "रकम",
  note: "टिप्पणी:",
  total: "कुल योग",
  amountInWords: "अक्षरी रुपये:",
  paymentType: "भुगतान का प्रकार:",
  cash: "नगदी",
  cheque: "चेक",
  online: "ऑनलाइन",
  chequeNo: "चेक नं.",
  bank: "बैंक:",
  receivedWithThanks: "द्वारा सधन्यवाद प्राप्त हुए",
  signature: "अधिकृत हस्ताक्षर",
  generated: "यह एक स्वतः जनित रसीद है",
};

const PAYMENT_TYPES: PaymentType[] = [HINDI.cash, HINDI.cheque, HINDI.online];

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDisplayDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function integerToWords(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const belowHundred = (n: number) => n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`;
  const belowThousand = (n: number) => {
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    return `${hundred ? ones[hundred] + " Hundred" : ""}${hundred && rest ? " " : ""}${rest ? belowHundred(rest) : ""}`;
  };
  if (num === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (num) parts.push(belowThousand(num));
  return parts.join(" ");
}

function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  return `Rupees ${integerToWords(rupees)}${paise ? ` and ${integerToWords(paise)} Paise` : ""} Only`;
}

function dottedLine(label: string, value = "", wide = true): string {
  return `
    <div style="display:flex;align-items:baseline;gap:4px;${wide ? "flex:1;" : ""}">
      <span style="font-size:13px;font-weight:500;color:#1a2e5a;white-space:nowrap;">${label}</span>
      <span style="flex:1;border-bottom:1px dotted #1a2e5a;min-width:40px;font-size:13px;color:#1a2e5a;padding:0 4px 1px;">${escapeHTML(value)}</span>
    </div>`;
}

function radioDot(selected: boolean): string {
  return `
    <span style="width:14px;height:14px;border-radius:999px;border:1px solid #1a2e5a;display:inline-flex;align-items:center;justify-content:center;background:${selected ? "#1a2e5a" : "white"};">
      ${selected ? '<span style="width:6px;height:6px;border-radius:999px;background:white;display:block;"></span>' : ""}
    </span>`;
}

function buildVoucherHTML(entry: VoucherPDFEntry): string {
  const lineItems = entry.lineItems?.length ? entry.lineItems : [{ account: entry.account, amount: entry.amount, remarks: entry.remarks }];
  const paymentType = entry.paymentType ?? HINDI.cash;
  const rowsHTML = lineItems.map((line, idx) => `
    <div style="display:grid;grid-template-columns:1fr 160px;${idx > 0 ? "border-top:1px solid rgba(26,46,90,0.15);" : ""}">
      <div style="padding:10px 16px;">
        <p style="font-size:13px;color:#1a2e5a;font-weight:500;margin:0;">${escapeHTML(line.account)}</p>
        ${line.remarks ? `<p style="font-size:11px;color:rgba(26,46,90,0.55);margin:2px 0 0;font-style:italic;">${HINDI.note} ${escapeHTML(line.remarks)}</p>` : ""}
      </div>
      <div style="padding:10px 16px;text-align:right;border-left:1px solid rgba(26,46,90,0.2);">
        <span style="font-size:13px;font-weight:600;color:#1a2e5a;">Rs. ${formatINR(line.amount)}</span>
      </div>
    </div>`).join("");

  return `
    <div style="width:680px;background:white;border:1px solid rgba(26,46,90,0.2);border-radius:2px;overflow:hidden;font-family:'Noto Sans Devanagari','Noto Sans',Arial,sans-serif;color:#1a2e5a;box-sizing:border-box;">
      <div style="height:6px;background:linear-gradient(to right,#1a2e5a,#c8902a,#1a2e5a);"></div>
      <div style="padding:20px 32px 28px;">
        <div style="text-align:center;margin-bottom:12px;">
          <p style="font-size:11px;letter-spacing:3px;margin:0 0 4px;color:#1a2e5a;">${TRUST_DATA.mangalacharana}</p>
          <h1 style="font-size:22px;font-weight:700;line-height:1.25;margin:0;color:#1a2e5a;">${TRUST_DATA.trustName}</h1>
          <p style="font-size:12px;color:rgba(26,46,90,0.8);margin:4px 0 0;">${TRUST_DATA.office}</p>
        </div>
        <div style="border-top:2px solid #1a2e5a;margin-top:12px;margin-bottom:2px;"></div>
        <div style="border-top:1px solid rgba(26,46,90,0.4);margin-bottom:16px;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div><span style="font-size:12px;color:rgba(26,46,90,0.7);">${HINDI.serial}</span> <span style="font-size:15px;font-weight:700;letter-spacing:1px;">${escapeHTML(entry.voucherNo)}</span></div>
          <div style="border:2px solid #1a2e5a;padding:4px 24px;border-radius:2px;"><span style="font-size:16px;font-weight:700;letter-spacing:3px;">${HINDI.receipt}</span></div>
          <div><span style="font-size:12px;color:rgba(26,46,90,0.7);">${HINDI.date}</span> <span style="font-size:13px;font-weight:600;">${formatDisplayDate(entry.date)}</span></div>
        </div>
        <div style="display:flex;gap:16px;margin-bottom:20px;">
          ${dottedLine(HINDI.shreeman, entry.vendor)}
          ${entry.haste?.trim() ? dottedLine(HINDI.haste, entry.haste) : ""}
        </div>
        <div style="border:1px solid #1a2e5a;border-radius:2px;overflow:hidden;margin-bottom:16px;">
          <div style="display:grid;grid-template-columns:1fr 160px;background:#1a2e5a;">
            <div style="padding:6px 16px;text-align:center;"><span style="font-size:12px;font-weight:600;color:white;letter-spacing:0.5px;">${HINDI.details}</span></div>
            <div style="padding:6px 16px;text-align:center;border-left:1px solid rgba(255,255,255,0.3);"><span style="font-size:12px;font-weight:600;color:white;letter-spacing:0.5px;">${HINDI.amount}</span></div>
          </div>
          ${rowsHTML}
          <div style="display:grid;grid-template-columns:1fr 160px;border-top:1px solid rgba(26,46,90,0.3);background:#f7f4ef;">
            <div style="padding:8px 16px;text-align:right;"><span style="font-size:12px;font-weight:600;">${HINDI.total}</span></div>
            <div style="padding:8px 16px;text-align:right;border-left:1px solid rgba(26,46,90,0.2);"><span style="font-size:13px;font-weight:700;">Rs. ${formatINR(entry.amount)}</span></div>
          </div>
        </div>
        ${entry.remarks?.trim() ? `<div style="margin-bottom:14px;">${dottedLine(HINDI.note, entry.remarks)}</div>` : ""}
        <div style="margin-bottom:16px;display:flex;align-items:baseline;gap:6px;">
          <span style="font-size:12px;color:rgba(26,46,90,0.7);white-space:nowrap;">${HINDI.amountInWords}</span>
          <span style="flex:1;font-size:12px;font-style:italic;color:#1a2e5a;padding:0 4px 1px;border-bottom:1px dotted rgba(26,46,90,0.5);">${amountInWords(entry.amount)}</span>
        </div>
        <div style="margin-bottom:8px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 20px;">
          <span style="font-size:12px;color:rgba(26,46,90,0.7);white-space:nowrap;">${HINDI.paymentType}</span>
          ${PAYMENT_TYPES.map((type) => `<span style="display:flex;align-items:center;gap:6px;">${radioDot(paymentType === type)}<span style="font-size:12px;">${type}</span></span>`).join("")}
        </div>
        ${paymentType === HINDI.cheque ? `<div style="display:flex;gap:20px;margin-bottom:16px;padding-top:4px;">${dottedLine(HINDI.chequeNo, entry.chequeNo)}${dottedLine(HINDI.bank, entry.bankName)}</div>` : '<div style="margin-bottom:16px;"></div>'}
        <div style="border-top:1px solid rgba(26,46,90,0.4);margin-bottom:2px;"></div>
        <div style="border-top:2px solid #1a2e5a;margin-bottom:16px;"></div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:20px;">
          <span style="font-size:13px;font-weight:500;">${HINDI.receivedWithThanks}</span>
          <div style="text-align:right;"><div style="height:32px;width:128px;margin-bottom:2px;border-bottom:1px dotted rgba(26,46,90,0.5);"></div><span style="font-size:10px;color:rgba(26,46,90,0.6);">${HINDI.signature}</span></div>
        </div>
        <p style="text-align:center;font-size:10px;color:rgba(26,46,90,0.45);font-style:italic;margin:0;">${HINDI.generated}</p>
      </div>
      <div style="height:6px;background:linear-gradient(to right,#1a2e5a,#c8902a,#1a2e5a);"></div>
    </div>`;
}

/** Lower the render scale as batch size grows, since memory pressure from many
 *  back-to-back html2canvas renders (each ~scale^2 pixels) is the main reason
 *  large split batches were failing to produce a PDF on phones/PWAs. */
function scaleForBatch(count: number): number {
  if (count <= 4) return 2;
  if (count <= 8) return 1.5;
  return 1.25;
}

async function renderVoucherToCanvas(entry: VoucherPDFEntry, scale: number): Promise<HTMLCanvasElement> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "680px";
  container.innerHTML = buildVoucherHTML(entry);
  document.body.appendChild(container);
  try {
    await document.fonts.ready;
    return await html2canvas(container, {
      scale,
      useCORS: true,
      backgroundColor: "#ffffff",
      width: 680,
    });
  } finally {
    // Always remove the offscreen container, even if html2canvas throws.
    container.remove();
  }
}

function freeCanvas(canvas: HTMLCanvasElement) {
  // Dropping the backing pixel buffer immediately (instead of waiting for GC)
  // matters a lot on memory-constrained mobile WebViews when rendering many pages back to back.
  canvas.width = 0;
  canvas.height = 0;
}

export interface VoucherPDFResult {
  blob: Blob;
  failed: { voucherNo: string }[];
}

async function buildVoucherPDF(entries: VoucherPDFEntry[]): Promise<VoucherPDFResult> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const scale = scaleForBatch(entries.length);
  const failed: { voucherNo: string }[] = [];
  let pagesAdded = 0;

  for (let i = 0; i < entries.length; i++) {
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await renderVoucherToCanvas(entries[i], scale);
      const imgData = canvas.toDataURL("image/png");
      const imgW = 180;
      const imgH = imgW * (canvas.height / canvas.width);
      if (pagesAdded > 0) doc.addPage();
      doc.addImage(imgData, "PNG", (pageW - imgW) / 2, 12, imgW, Math.min(imgH, pageH - 24));
      pagesAdded++;
    } catch (err) {
      // Don't let one bad page take down the whole batch — record it and keep going,
      // so the user still gets a PDF with everything that did render.
      console.error(`Voucher PDF: failed to render ${entries[i].voucherNo}`, err);
      failed.push({ voucherNo: entries[i].voucherNo });
    } finally {
      if (canvas) freeCanvas(canvas);
    }
    // Yield to the browser between heavy renders so it has a chance to reclaim
    // memory before starting the next one (helps a lot on installed PWAs/phones).
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }

  if (pagesAdded === 0) {
    throw new Error("Could not render any receipt pages for this PDF.");
  }

  return { blob: doc.output("blob"), failed };
}

async function shareOrDownload(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function openVoucherPDF(entries: VoucherPDFEntry[]): Promise<{ failed: { voucherNo: string }[] }> {
  const { blob, failed } = await buildVoucherPDF(entries);
  const filename =
    entries.length === 1
      ? `${entries[0].voucherNo}.pdf`
      : `receipts-${entries[0].voucherNo}-to-${entries[entries.length - 1].voucherNo}.pdf`;
  await shareOrDownload(blob, filename);
  return { failed };
}
