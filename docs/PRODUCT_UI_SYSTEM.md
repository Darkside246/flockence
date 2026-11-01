# Chicken Op Premium UI System

## Product direction
Chicken Op uses a premium agricultural operations cockpit rather than a spreadsheet-style admin screen. The visual language is inspired by the supplied reference: a calm light canvas, floating white surfaces, compact navigation, rounded controls, strong hierarchy, and graphical summaries before dense text.

## Brand tokens
- Forest: `#2E5A12`
- Leaf: `#7CB733`
- Slate: `#232B1C`
- Warm gold: `#E0A21E`
- Alert amber: `#9B6500`
- Alert crimson: `#A63C32`
- Teal data state: `#2F7B6E`
- Canvas: soft warm agrarian off-white

Typography uses the system sans stack with Inter/SF Pro/Segoe UI fallbacks so the application remains self-contained. Large values use tight tracking and heavy weight; labels stay small and legible.

## Component rules
- Cards are floating surfaces with a restrained border, layered shadow and a small lift on hover.
- Primary actions use forest-to-leaf gradients.
- Gold is reserved for commercial or attention states, not general decoration.
- Red is reserved for risk or failure.
- Graphs must use recorded data. Empty states must explain what data is missing rather than inventing values.
- Interactive controls use rounded 12–16px geometry and a minimum 48px touch target on mobile.
- Forms use large labels and clear focus rings for use in the yard.

## Information architecture
Dashboard → Batches → Operations → House → Pens → Performance → Health → Inventory → Finances → Production → Reports → Settings.

High-frequency tasks are promoted to the Dashboard Quick Action Hub: New batch, Record mortality, Add feed, Record sale.

## Dashboard to daily-log prototype flow
1. Operator lands on Dashboard and sees current live birds, active batches, mortality, economic position and inventory.
2. Operator chooses a Quick Action from the floating task tiles.
3. The target operational screen opens with the relevant form positioned first, minimizing navigation and typing.
4. After submission, the record is stored as actual farm data and the dashboard metrics refresh on return.
5. Alerts appear only when current recorded data creates an operational issue.

## Responsive model
Desktop uses a persistent left navigation rail. Tablet keeps the rail but compresses content. Mobile moves primary navigation to a bottom bar and exposes the full navigation through a hamburger drawer. This mirrors the supplied reference without copying its payroll-specific content.

## State model
The UI explicitly distinguishes:
- `ACTUAL`: recorded farm facts
- `ESTIMATE`: editable assumption or planning value
- `FORECAST`: calculated future projection
- `OFFLINE`: local operation pending synchronization
- `SYNCING`: operation being uploaded
- `NOT CONNECTED`: sensor or external integration has no live feed

No chart should display synthetic farm measurements just to make the dashboard look populated.
