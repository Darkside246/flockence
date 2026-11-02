# Owner fixes requested 2026-11-02 (Flockence) - not built yet

From the owner, with a screenshot of the Surveillance > Cameras strip (Test House RTSP offline, Backyard, Side door,
Mini on Blink).

## 1. Buttons say what happened

- **Start flow:** after pressing it, the button shows the result: "Saved" or "Started" (green tick) for a few
  seconds, or the plain reason it failed. No silent presses.
- **Record mortality** (and every other record form: feeding, water, weights, eggs, medication): the same. Today you
  cannot tell whether it saved. Show "Saved" on the button and clear or keep the form clearly; on failure show the
  short reason next to the button.
- The button styling is "ugly". Use the app's own button look (see `docs/PRODUCT_UI_SYSTEM.md`), not a default.

## 2. Colour

- The grey (camera tiles, buttons) looks tacky. Pick a colour that fits the app's dark theme and teal accent (see
  the screenshot: teal corner marks and headings), e.g. a deep teal/ink surface instead of flat grey. Check every
  theme.

## 3. Choose which cameras show

- Show every camera the link has found (whatever the app knows: Blink, RTSP, etc.) in a list with a tick box each.
- Ticked cameras appear on the Cameras screen and its strip. Unticked ones do not appear there at all (not hidden
  under "3 more"). The choice is saved per farm.
- Only owners/managers change it.

## 4. No records for a day that has not come

- Mortality, feeding and every other chicken record cannot be entered for a date after today (the owner's example:
  you cannot record a bird dead on the 10th when today is the 8th).
- The date picker stops at today (`max` = today in the farm's own time zone, not the server's or UTC).
- If a future date still gets through, show a short notice beside the date: **"That date hasn't come yet."**
- The server keeps refusing it (already true for mortality in `app/api/mortality/route.ts`; check every other
  record route does the same).

## 5. Clear error messages, one per problem

The owner gets errors like:

`Error: {"error":"Batch, a current or historical date and a positive whole-bird quantity are required."}`

and similar ones on other forms. Fix:

- Never show raw JSON. Show only the message, beside the field it is about.
- One message per problem, short: "Choose a batch.", "That date hasn't come yet.", "Before this batch started.",
  "Enter a whole number of birds, 1 or more.", "More than the birds left in this batch."
- Check how the error came up (likely a missing batch choice or the date check). Check the "today" date the form
  fills in is the farm's local date: after 8 pm in Barbados, UTC is already tomorrow.
- Go through every form and API route that returns a combined "X, Y and Z are required" error and split it.

## Owner tests once built

1. Press Start flow: the button says it worked (or why not).
2. Record a mortality: the button says "Saved"; the batch's live count drops.
3. Try the 10th when today is the 8th: the picker will not allow it; typed in, it says "That date hasn't come yet."
4. Leave the batch empty: "Choose a batch." beside it, no JSON.
5. Cameras: untick Side door: it no longer appears on the Cameras screen; tick it again: it is back.
6. The grey surfaces now match the app's colours.
