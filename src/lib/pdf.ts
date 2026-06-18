import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

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

function buildVoucherHTML(entry: VoucherPDFEntry): string {
  const rows = [
    [directionLabel(entry.direction), entry.vendor],
    ["Amount", `Rs. ${formatINR(entry.amount)}`],
    ["Account", entry.account],
  ];

  const rowsHTML = rows
    .map(
      ([label, value]) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:10px 0;border-bottom:1px solid #f0f0f0;">
        <span style="color:#555;font-size:13px;">${label}</span>
        <span style="color:#1c1c1e;font-size:13px;text-align:right;max-width:60%;">${value}</span>
      </div>`
    )
    .join("");

  return `
    <div style="
      width:794px;
      min-height:400px;
      padding:40px 56px;
      font-family:'Noto Sans Devanagari','Noto Sans',Arial,sans-serif;
      background:#fff;
      box-sizing:border-box;
      color:#1c1c1e;
    ">
      <div style="font-size:18px;font-weight:600;margin-bottom:4px;">${TRUST_NAME}</div>
      <div style="font-size:13px;color:#555;margin-bottom:16px;">${TRUST_ADDRESS}</div>
      <hr style="border:none;border-top:1px solid #dcdcdc;margin-bottom:16px;" />
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
        <span style="font-size:20px;font-weight:700;letter-spacing:0.5px;">PAYMENT VOUCHER</span>
        <span style="font-size:12px;color:#555;">${entry.voucherNo}</span>
      </div>
      <div style="font-size:13px;color:#1c1c1e;margin-bottom:16px;">Date: ${formatDisplayDate(entry.date)}</div>
      <hr style="border:none;border-top:1px solid #dcdcdc;margin-bottom:8px;" />
      ${rowsHTML}
      <div style="margin-top:48px;display:flex;justify-content:flex-end;">
        <div style="text-align:center;min-width:160px;">
          <div style="border-top:1px solid #1c1c1e;padding-top:8px;font-size:11px;color:#555;">Authorised Signatory</div>
        </div>
      </div>
    </div>
  `;
}

async function renderVoucherToCanvas(entry: VoucherPDFEntry): Promise<HTMLCanvasElement> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "794px";
  container.innerHTML = buildVoucherHTML(entry);
  document.body.appendChild(container);

  await document.fonts.ready;

  const canvas = await html2canvas(container, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    width: 794,
  });

  document.body.removeChild(container);
  return canvas;
}

async function buildVoucherPDF(entries: VoucherPDFEntry[]): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;

  for (let i = 0; i < entries.length; i++) {
    if (i > 0) doc.addPage();
    const canvas = await renderVoucherToCanvas(entries[i]);
    const imgData = canvas.toDataURL("image/png");
    const canvasAspect = canvas.height / canvas.width;
    const imgW = pageW;
    const imgH = imgW * canvasAspect;
    doc.addImage(imgData, "PNG", 0, 0, imgW, Math.min(imgH, pageH));
  }

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
