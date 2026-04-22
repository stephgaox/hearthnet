# Family Budget Dashboard — Changelog

---

## 2026-04-21 — Profile editing & UI fixes

### Frontend — EditProfileModal.tsx (new component)
- Edit name, avatar color (8 swatches with live preview), and passcode from a single modal
- Passcode section adapts: "Add passcode" if none set, "Change passcode" if one exists
- "Remove passcode" link with inline confirmation banner before saving
- Only changed fields are sent in the PATCH payload

### Frontend — App.tsx
- Header avatar button now opens a dropdown with **Edit Profile** and **Switch User** options instead of switching directly
- Sidebar footer gains an "Edit" button alongside "Switch"
- `onUpdated` callback refreshes `currentUser` state and localStorage immediately so name/color update in the header without a page reload
- Sticky header bumped from `z-10` → `z-20` to always render above hovered summary cards (fixes tooltip/card overlap with headline on scroll)

### Frontend — ManageModal.tsx (Accounts tab)
- Clicking an account row now expands an inline edit form with name, type toggle (Credit / Bank / Investment), and last 4 digits
- Clicking the row again collapses the form
- Save calls `PATCH /api/accounts/:id`; list updates immediately
- Previous behavior was rename-only via a single inline text input

---

## 2026-04-21 — Multi-user support (JWT auth + profile switcher)

### Backend — new files
- **`auth.py`** — JWT creation/verification (PyJWT, HS256, 30-day expiry), bcrypt passcode hashing, `get_current_user` FastAPI dependency; `JWT_SECRET` configurable via env var
- **`routers/users.py`** — `GET /api/users` (public, profile list), `POST /api/auth/login` (public), `POST /api/users` (public, create profile + seed categories), `PATCH /api/users/:id` (authenticated), `DELETE /api/users/:id` (authenticated, blocked if user has transactions)

### Backend — models.py
- New `User` model: `id, name, passcode_hash (nullable), avatar_color, created_at`
- Added `user_id` FK to `Account`, `Category`, `Transaction` tables

### Backend — database.py
- `seed_user_categories(db, user_id)` — idempotent per-user category seeding
- `create_tables()` migration: creates Default user (id=1), adds `user_id` columns to existing tables via `ALTER TABLE ADD COLUMN DEFAULT 1`; recreates `categories` table with `UNIQUE(name, user_id)` composite constraint (replacing single-column unique)

### Backend — all routers (transactions, dashboard, settings, upload)
- Every endpoint now scoped to the authenticated user via `Depends(get_current_user)`
- All DB queries filtered by `user_id`; new records stamped with `user_id`

### Backend — main.py
- `ALLOWED_ORIGINS` configurable via env var (comma-separated) for future online deployment

### Backend — requirements.txt
- Added `PyJWT>=2.8.0` and `bcrypt>=4.0.0`

### Frontend — types/index.ts
- Added `User` interface: `{ id, name, avatar_color, has_passcode, token? }`

### Frontend — api/client.ts
- `setAuthToken`, `setCurrentUser`, `getStoredUser` — localStorage + Axios header management
- Token restored from localStorage on module init
- 401 interceptor fires `auth:logout` event only when a stored token exists (prevents false logout during login/passcode entry)
- New API functions: `getUsers`, `loginUser`, `createUser`, `updateUser`, `deleteUser`

### Frontend — UserSwitcher.tsx (new component)
- Netflix-style profile picker grid with avatar initials and color circles
- Lock icon shown for passcode-protected profiles
- Passcode entry screen per-user
- "Add Profile" card with optional passcode + confirm
- Network error vs. API error distinction in error messages

### Frontend — App.tsx
- Shows `UserSwitcher` when no user is logged in; restores session from localStorage on load
- Listens for `auth:logout` event → returns to profile picker
- User avatar (initials circle) in header and sidebar with "Switch" button

### Config — .env.example
- Added `JWT_SECRET` (required for production) and `ALLOWED_ORIGINS` documentation

---

## 2026-04-07 — File management & upload UX improvements

### Backend — routers/transactions.py
- `GET /transactions/source-files` now accepts optional `?account_id=` query param — returns only files belonging to that account, ordered by latest statement date descending

### Backend — routers/upload.py
- `POST /upload/confirm` now accepts `account_id` directly in the payload — when provided, skips `_get_or_create_account` and links transactions to the existing account directly

### Frontend — api/client.ts
- `getSourceFiles(account_id?)` — optional account filter added
- `confirmUpload(...)` — added optional `accountId` parameter; passes `account_id` to backend when an existing account is selected, omits `account` object

### Frontend — UploadModal.tsx
- **Auto-detect account on upload** — after parsing, matches the `account_hint` against existing accounts by: (1) `last4` + `institution`, (2) `last4` only, (3) `institution` + `type`
- **Matched account card** — when a match is found, shows a green-bordered card with account name and color dot instead of the full form; "Change" link drops back to the manual picker
- **No match** — falls through to the existing new-account form, pre-filled from the parser hint as before
- **Dashboard jump on save** — after confirming, computes the latest date across all parsed transactions and passes `{ year, month }` to `onDone`; App.tsx navigates to that month view automatically

### Frontend — App.tsx
- `handleUploadDone(jumpTo?)` — sets year, month, and switches to month view when a jump target is provided

### Frontend — ManageModal.tsx (Danger Zone)
- Uploaded files list trimmed to 5 most recent (was 10 with an "Archived" accordion)
- Removed "Archived" expand/collapse section
- Added note directing users to each account's statement view for full file history per account

### Frontend — StatementsView.tsx
- **"Manage Files" button** added next to "Download CSV" in the account header
- **Files panel** — toggles an inline panel below the header showing all files uploaded to this account (newest → oldest by statement date), with filename, transaction count, date range, and an inline two-step delete confirmation
- Fixed pre-existing TypeScript error: `handleTypeChange` parameter narrowed from `string` to `Transaction['type']`
- **Sticky table header** — `<thead className="sticky top-16 z-10">` keeps column headers visible while scrolling; `overflow-hidden` on wrapper changed to `overflow-clip` to preserve rounded corners without breaking sticky positioning

---

## 2026-04-07 — UX polish

### Frontend — TransactionList.tsx
- **Sticky table header** — `<thead>` is now `sticky top-16 z-[5] bg-surface-card`; column headers remain visible as users scroll through long transaction lists, sitting flush below the fixed app header

### Frontend — App.tsx
- **Scroll-to-top button** — floating `bottom-6 right-6` button appears after scrolling 400px; fades in with opacity + subtle upward translate; clicking scrolls smoothly to the top of the page

---

## 2026-04-07 — Remove Invested calculation

### Backend — dashboard.py
- Removed `_INVESTMENT_KW` keyword list and all investment detection logic from `_aggregate_monthly`
- Removed `invested` field from the return dict of `_aggregate_monthly` and from both `/dashboard/monthly` and `/dashboard/yearly` responses
- Removed now-dead `transfer_in_pool` pre-pass (was only needed to balance investment detection)

### Frontend
- `types/index.ts` — removed `invested: number` from `MonthlyDashboard` and `YearlyDashboard` interfaces
- `Dashboard.tsx` — removed `invested` state, all `setInvested` calls, and the `invested` prop passed to `SummaryCards`
- `SummaryCards.tsx` — removed `invested` prop and the "+ Invested" row in the Saved card

---

## 2026-04-07 — Sidebar & Statements view polish

### Frontend — App.tsx (sidebar)
- Account names in Statements section reduced to `text-xs` (was `text-sm`) for a more compact sidebar
- Date range subtitles reduced to `text-[11px]` to visually subordinate them below account names
- Sidebar backdrop now fades in/out with `transition-opacity duration-200` matching the slide animation (was instant)
- Added `aria-label="Site navigation"` to `<aside>` element
- Added visual `border-t` divider between Dashboard link and Statements section
- Sidebar close button: `text-text-faint` → `text-text-muted` for better affordance

### Frontend — StatementsView.tsx
- **Date range filter**: replaced text search with two `<input type="date">` pickers (from / to) — filters by `t.date >= dateFrom && t.date <= dateTo`
- **Date column sort**: sort toggle moved from filter toolbar into the Date column header (clickable chevron); mobile retains a toolbar sort button
- **Amount sign flip**: hover-reveal ↕ button in Amount column flips `income↔expense` or `transfer_in↔transfer_out`; updates DB and local state immediately
- **Column proportions**: Description capped at `max-w-[220px]`; Category and Type columns widened to `w-44` each
- **Extracted `TypeEditor`** component to eliminate duplicate segmented-control markup between mobile and desktop
- Description, Category, Amount: normalized to `text-sm` to match TransactionList
- Row padding: `py-2.5` → `py-3`; table header font: `font-medium` → `font-semibold`
- Added mobile card view (`md:hidden`) matching TransactionList's dual-layout pattern

## 2026-04-06 — Year view CC payments note
- Dashboard year view now shows "ⓘ CC bill payments ($X) are not shown" on the pie chart — was always zero in year view; now reads `CC Payments` from `cats.data.bank`

---

## 2026-04-06 — Sidebar navigation & Statements view

### Backend
- **New endpoint `GET /accounts/date-ranges`** (`settings.py`) — returns `{account_id, min_date, max_date}` per account derived from transaction dates; used by sidebar to show coverage range without a separate query

### Frontend — App.tsx
- **Hamburger menu** — three-line icon before logo opens a slide-in sidebar (`w-64`, `z-40`, `transition-transform duration-200`)
- **Sidebar sections**: Dashboard link (active-highlighted), STATEMENTS (all accounts with color dot + date range), COMING SOON stubs (Budget Goals, Reports — non-clickable with "soon" badge)
- Month/year nav controls hidden when Statements view is active
- Logo click returns to Dashboard from any view
- `appView` state (`{ mode: 'dashboard' } | { mode: 'statements'; account }`) drives top-level view switching
- `getAccountDateRanges()` added to `api/client.ts`

### Frontend — StatementsView.tsx (new component)
- Per-account read-only spreadsheet of all transactions across all time, fetched via `GET /api/transactions?account_id=X`
- Transactions grouped by year with income/expense totals per group
- **Limited inline editing**: category (click badge → select dropdown) and type (click badge → ±↑↓ segmented control) — date, description, and amount value remain read-only to preserve statement integrity
- Filter toolbar: date range pickers, type filter, category filter, "Clear filters" link; filtered count shown in account header
- Sort by date via Date column header (desktop) and toolbar toggle (mobile)
- Download CSV exports currently filtered rows
- Dual layout: mobile card view (`md:hidden`) + desktop table (`hidden md:block`)

---

## 2026-04-06 — Dashboard UX improvements

### Frontend — SummaryCards.tsx
- **Tooltip accuracy**: Income and Spending hover breakdown cards now pass `account_type=bank_account` to breakdown endpoints — only accounts that actually contribute to the headline totals appear in the tooltip (previously all account types were shown)
- **Explain icons on card headers**: ⓘ icon added to Total Income and Total Spending headers; hover tooltip explains the calculation in plain language (e.g. "Money deposited into your bank accounts")
- `stopPropagation` on ⓘ icon prevents the explain tooltip from also triggering the account breakdown hover

### Backend — direct_parser.py
- **Investment transfer detection**: brokerage names in description (robinhood, fidelity, vanguard, schwab, etc.) force `type = transfer_out` — enables dashboard investment-keyword detection to correctly count these as invested rather than as plain expenses

---

## 2026-04-06 — Upload notifications

### Frontend — UploadModal.tsx
- **Category accuracy notice**: after a successful CSV upload, a blue info banner explains that AI categorization may not be perfect and directs users to review in the transaction list
- **Venmo/Zelle/Check warning**: if any saved transaction description matches Venmo, Zelle, or Check patterns, a yellow warning banner prompts the user to manually review and correct the type/category for those transactions
- Fixed pre-existing TypeScript error: `accountType` state widened from `'credit_card' | 'bank_account'` to include `'investment'`

---

## 2026-04-06 — Category UX improvements & Amex CSV parsing fixes

### Frontend
- **Bulk category change prompt** — when a user changes a transaction's category, the app detects other transactions on the current page with the same description and old category, and prompts "Change all [description] to [new category]? Yes / No"
- **Bulk change success toast** — after applying to all, shows "[N] transaction(s) updated to [category]" for 4 seconds; dismissible; triggers dashboard recalculation

### Backend / Parsers
- **Amex CSV sign-convention fix** (`direct_parser.py`) — the ≥65% positive-amount heuristic failed for Amex Platinum cards with many statement credits (hotel credit, Walmart+ credit, entertainment credit), which pushed the positive ratio to ~50%. Added a fallback: if the ratio is below 65%, scan descriptions for Amex-specific strings (`"mobile payment"`, `"platinum hotel credit"`, etc.) — one match is enough to set `positive_expense = True`
- **Expanded merchant keywords** — added: SEPHORA, SAKS, UNIQLO, BED BATH & BEYOND (Shopping); ENTERPRISE RENTACAR, HERTZ, AVIS, AMEX TRAVEL, AMERICAN EXPRESS TRA (Travel); ROVER.COM (Pet); ACTIVEWORKS (Kids & Childcare); DISNEY PLUS with space variant (Subscriptions); SP SPROUT (Groceries)
- **Semantic category indicators** (`direct_parser.py`) — new last-resort pass in `_map_category` using generic words embedded in descriptions: `hotel/resort/lodging/travel/airline` → Travel; `utility/utilitypmt` → Bills & Utilities; `grocery/supermarket` → Groceries; `medical/health/doctor` → Medical; `membership/subscription` → Subscriptions; `hardware/moving/furniture` → Home; and more — eliminates most "Other" results for unknown merchants without needing explicit merchant entries

---

## 2026-04-06 — Cash-Basis Two-Ecosystem Architecture

### Breaking Changes
- Transaction `type` field: generic `transfer` split into directional `transfer_in` / `transfer_out`
  - Legacy `transfer` rows remain valid and are handled everywhere
- `GET /dashboard/yearly/categories` now returns `{all, bank, cc}` instead of a flat list
- `GET /dashboard/monthly` response adds `categories_bank`, `categories_cc`, `cc_net_charges`

### Backend

**Models**
- `amount` column: `Float` → `Numeric(12, 2, asdecimal=False)` — penny-precise schema, no float drift

**Parsers**
- `direct_parser.py` — CC bill payments → `transfer_out`; payment received on CC → `transfer_in`; plain transfers directional by raw sign
- `pdf_parser.py` — `_classify_type()` returns `transfer_out` (debit) / `transfer_in` (credit) instead of `transfer`
- `ai_parser.py` — system prompt updated; PDF chunking fixed (was cutting off at 8,000 chars, now loops at 28,000); CSV chunk reduced 400→150 rows, `[:12000]` truncation removed

**Dashboard (`dashboard.py`)**
- Bank ecosystem: Income = bank `income` only; Expense = bank direct + CC payments (`transfer_out` + `CC Payments`); Net Savings = Income − Expense
- CC ecosystem: `CC Net Charges` = CC expenses − CC refunds; `Payment Received` excluded
- Bar chart (`/monthly/context`, `/yearly`) filtered to bank accounts only — no double-counting
- Investment detection: balances `transfer_out`/`transfer_in` pairs by amount before applying keyword check — eliminates false positives (e.g. JPMORGAN CHASE inter-bank transfers)
- `/yearly/categories` returns three sets: `all`, `bank`, `cc`

**Data Integrity**
- `transactions.py` — replaced `_TRANSFER_CATEGORIES` (was forcing everything to `transfer`) with directional `_CATEGORY_TYPE_MAP`: `CC Payments → transfer_out`, `Payment Received → transfer_in`, `Withdraw → transfer_out`
- `upload.py` — `/upload/confirm` maps category→type on save; merchant learning now replays category only (not type)
- `settings.py` — category rename/merge check is now case-insensitive (`func.lower()`)

### Frontend

**New features**
- Pie chart source toggle: All / Bank / CC
- Pie chart hover tooltip: `Category · $Amount`
- Amount column: positive (income, transfer_in) = green `+`; negative = plain; fixed width `w-28`

**Bug fixes**
- `SummaryCards.tsx` — fixed `overflow-hidden` clipping the Saved card tooltip; removed stale tooltip text
- `TransactionList.tsx` — inline type editor updated with `↑`/`↓` buttons for `transfer_out`/`transfer_in`; `handleCategoryChange` auto-sets type for special categories
- `UploadModal.tsx` / `ManageModal.tsx` — type color logic updated for `transfer_in`/`transfer_out`
