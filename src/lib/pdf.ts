import { jsPDF } from "jspdf";

export interface VoucherPDFEntry {
  direction: "paid" | "received";
  vendor: string;
  amount: number;
  account: string;
  date: string;
  voucherNo: string;
}

const TRUST_NAME = "श्री श्वेतांबर जैन तपागच्छ उपाश्रय ट्रस्ट";
const TRUST_ADDRESS = "4/2 रेस कोर्स रोड, इंदौर";

let fontDataPromise: Promise<string> | null = null;

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

function directionLabel(direction: VoucherPDFEntry["direction"]): string {
  return direction === "paid" ? "Paid to" : "Received from";
}

async function loadDevanagariFont(): Promise<string> {
  if (!fontDataPromise) {
    fontDataPromise = fetch(`${import.meta.env.BASE_URL}fonts/NotoSansDevanagari-Regular.ttf`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load Devanagari font");
        return res.arrayBuffer();
      })
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      });
  }
  return fontDataPromise;
}

function addDivider(doc: jsPDF, y: number): number {
  doc.setDrawColor(220, 220, 220);
  doc.line(20, y, 190, y);
  return y + 8;
}

function drawVoucherPage(doc: jsPDF, entry: VoucherPDFEntry, fontLoaded: boolean) {
  const deva = fontLoaded ? "NotoSansDevanagari" : "helvetica";

  doc.setFont(deva, "normal");
  doc.setFontSize(16);
  doc.text(TRUST_NAME, 20, 28);

  doc.setFontSize(11);
  doc.setTextColor(85, 85, 85);
  doc.text(TRUST_ADDRESS, 20, 36);
  doc.setTextColor(28, 28, 30);

  let y = addDivider(doc, 44);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("PAYMENT VOUCHER", 20, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(85, 85, 85);
  doc.text(entry.voucherNo, 190, y + 6, { align: "right" });
  doc.setTextColor(28, 28, 30);
  y += 14;
  doc.text(`Date: ${formatDisplayDate(entry.date)}`, 20, y);

  y = addDivider(doc, y + 6);

  const rows: [string, string][] = [
    [directionLabel(entry.direction), entry.vendor],
    ["Amount", `₹ ${formatINR(entry.amount)}`],
    ["Account", entry.account],
  ];

  doc.setFontSize(12);
  for (const [label, value] of rows) {
    doc.setTextColor(85, 85, 85);
    doc.text(label, 20, y);
    doc.setTextColor(28, 28, 30);
    doc.setFont("helvetica", "normal");
    doc.text(value, 190, y, { align: "right", maxWidth: 110 });
    y += 10;
    doc.setDrawColor(240, 240, 240);
    doc.line(20, y - 4, 190, y - 4);
  }

  y += 24;
  doc.setDrawColor(28, 28, 30);
  doc.line(110, y, 190, y);
  doc.setFontSize(10);
  doc.setTextColor(85, 85, 85);
  doc.text("Authorised Signatory", 150, y + 8, { align: "center" });
}

async function buildVoucherPDF(entries: VoucherPDFEntry[]): Promise<Blob> {
  const fontBase64 = await loadDevanagariFont();
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  doc.addFileToVFS("NotoSansDevanagari-Regular.ttf", fontBase64);
  doc.addFont("NotoSansDevanagari-Regular.ttf", "NotoSansDevanagari", "normal");

  entries.forEach((entry, index) => {
    if (index > 0) doc.addPage();
    drawVoucherPage(doc, entry, true);
  });

  return doc.output("blob");
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

export async function openVoucherPDF(entries: VoucherPDFEntry[]) {
  const blob = await buildVoucherPDF(entries);
  const filename =
    entries.length === 1
      ? `${entries[0].voucherNo}.pdf`
      : `vouchers-${entries[0].voucherNo}-to-${entries[entries.length - 1].voucherNo}.pdf`;

  await shareOrDownload(blob, filename);
}
