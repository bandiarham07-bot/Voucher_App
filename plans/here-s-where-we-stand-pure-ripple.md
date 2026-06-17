# Receipt App — Plan

## Context

A single-page React app for a charitable trust to generate PDF receipts. Three tabs, iOS/iPad-inspired minimalist UI: white ground, one accent color, hairline borders, generous tap targets, subtle spring-like press feedback. No backend — all state is in-memory (localStorage for persistence of vendors/accounts/history).

---

## Aesthetic Decisions

- **Stance:** iOS Human Interface Guidelines — clean, functional, white ground
- **Accent:** `#007AFF` (iOS system blue) — used only on active tab, primary button, and focus rings
- **Font:** `Inter` (Google Fonts) — closest web match to SF Pro; medium weight for labels, regular for body
- **Radius:** `14px` for cards/fields, `12px` for buttons — iOS feel
- **Shadows:** ultra-subtle (`0 1px 3px rgba(0,0,0,0.08)`) on fields and cards
- **Tokens to update in `theme.css`:**
  - `--background: #ffffff`
  - `--foreground: #1c1c1e`
  - `--primary: #007AFF`
  - `--primary-foreground: #ffffff`
  - `--muted: #f2f2f7` (iOS grouped background)
  - `--muted-foreground: #8e8e93`
  - `--border: rgba(0,0,0,0.12)`
  - `--radius: 0.875rem`

---

## File Changes

### `src/styles/fonts.css`

Add Google Fonts import for Inter (weights 400, 500, 600).

### `src/styles/theme.css`

Update `:root` token values (above). Preserve `.dark` block and `@theme inline` mappings unchanged.

### `src/app/App.tsx`

Single file — full implementation. Key sections:

---

## Component Architecture (all in App.tsx)

### State

```
vendors: string[]          // persisted to localStorage
accounts: string[]         // persisted to localStorage
history: Receipt[]         // persisted to localStorage
activeTab: 'generate' | 'master' | 'history'
```

### Receipt type

```ts
{
  id: number;
  vendor: string;
  amount: number;
  account: string;
  date: string;
  receiptNo: string;
}
```

### Tab Bar

- Fixed bottom, 3 tabs: Receipt icon / Database icon / Clock icon (lucide-react)
- Active tab: accent blue icon + label; inactive: gray
- iOS-style separator line at top, white background, safe-area padding

### Generate Receipt Tab

Fields stacked top→bottom with `~56px` height iOS-style inputs:

1. **Vendor** — searchable dropdown with filtered list below field; "+ Add new vendor" as last option when no match found
2. **Amount** — numeric input, live Indian comma formatting (e.g. `1,23,456.50`), prefix `₹` inside field
3. **Account** — same searchable dropdown pattern as Vendor
4. **Date** — tappable field showing formatted date; opens a native `<input type="date">` on tap
5. **"Generate Receipt"** — full-width primary button, `56px` tall, accent blue fill, iOS press scale effect (`active:scale-[0.97]`)

On submit:

- Assign auto-incremented receipt number (format: `RCP-0001`, `RCP-0002`, …)
- Save to history (localStorage)
- Generate PDF via `jsPDF` (npm install needed) with: trust name placeholder, address placeholder, vendor, amount (formatted), account, date, receipt number, and a signature block
- Open print dialog / simulate share via `window.open(pdfUrl)`
- Show success toast via `sonner`

### Master Data Tab

Two sections separated by a labeled group header (iOS grouped table style):

- **Vendors** section: list of vendor names, each row with tap-to-edit (inline text input) and swipe-reveal delete (or a trash icon button on the right)
- **Accounts** section: same pattern
- Each section has a `+` button in the header to add a new entry
- New entries saved to localStorage immediately

### Receipt History Tab

- Search bar at top (filters by vendor name or date substring)
- Reverse-chronological list; each row: vendor name (bold), amount (`₹` formatted), date right-aligned
- Receipt number shown in a collapsed detail (tap row to expand)
- Swipe-reveal or icon actions: Edit (pencil) → opens a modal/sheet to re-edit fields, Delete (trash) → removes with confirmation

### Shared UI Patterns

- **SearchableDropdown component** — reused for Vendor and Account fields; shows filtered list in a floating panel below the field; "Add new" option appended when typed value doesn't match any existing entry
- **iOS press feedback** — `active:scale-[0.97] transition-transform duration-100` on all tappable rows and buttons
- **Input style** — `bg-muted rounded-[14px] px-4 h-14 w-full` with no visible border until focused (then thin accent ring)

---

## PDF Layout (jsPDF)

```
[Trust Name — placeholder]
[Address — placeholder]
─────────────────────────────
RECEIPT                          No. RCP-0001
Date: 17 June 2026
─────────────────────────────
Received from: [Vendor]
Amount: ₹ 1,23,456.00
Account: [Account]
─────────────────────────────
Signature: ___________________
           [Name / Title]
```

---

## Dependencies to Install

- `jspdf` — PDF generation

---

## Verification

1. Run dev server (`npm run dev`)
2. Add a vendor and account in Master Data — confirm localStorage persistence on refresh
3. Generate a receipt — confirm PDF opens, receipt appears in History
4. Search/filter in History tab
5. Edit and delete a history entry
6. Confirm Indian number formatting: typing `123456` shows `1,23,456`