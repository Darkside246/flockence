// How a flock health case moves from first report to a closed record. Pure rules (no database), so they can be tested.
//
//   OPEN        something is wrong and is being worked on (signs seen, treating, waiting for a result)
//   MONITORING  treated or settled, and being watched; it must carry the date of the next review
//   RESOLVED    the flock has recovered or the situation has ended; an outcome is recorded
//   CLOSED      nothing is left to do or wait for; the record is frozen (reopen it with a reason if it comes back)
//
// Shaped by common practice in flock health records and disease-control guidance: a case is never silently deleted;
// a monitored case has a review date; a result still pending blocks closing; movement restrictions are lifted on
// purpose, not by accident; a suspected notifiable disease stays flagged until it is reported; and every change leaves
// a dated line in the case's history. Withdrawal periods belong to each treatment and keep running after a case closes.

export const CASE_STATUSES = ["OPEN", "MONITORING", "RESOLVED", "CLOSED"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const OUTCOMES = {
  RECOVERED: "Recovered",
  PARTIAL_RECOVERY: "Partly recovered, some birds affected for good",
  CULLED: "Affected birds culled",
  FLOCK_REMOVED: "Flock sent for processing or removed",
  REFERRED_TO_VET: "Handed to a veterinarian or the authority",
  NOT_A_DISEASE: "Management or environment problem, now corrected",
  INCONCLUSIVE: "Cause not found; signs have stopped",
} as const;
export type Outcome = keyof typeof OUTCOMES;

export type CaseAction = "note" | "monitor" | "escalate" | "resolve" | "close" | "reopen" | "report";
export const ACTIONS_NEEDING_MANAGER: readonly CaseAction[] = ["resolve", "close", "reopen"];

export type CaseSnapshot = {
  status: CaseStatus;
  severity: string;
  affectedCount: number;
  deathsCount: number;
  movementRestricted: boolean;
  isolationRecommended: boolean;
  outcome: string | null;
  notifiable: boolean;
  reported: boolean;
  pendingTests: number;
};

export type ActionInput = {
  note?: string;
  nextReviewAt?: string | null; // YYYY-MM-DD
  severity?: string;
  affectedCount?: number;
  deathsCount?: number;
  outcome?: string;
  confirmedDiagnosis?: string;
  liftRestrictions?: boolean;
  notifiable?: boolean;
  reportedToAuthorityAt?: string | null;
  authorityReference?: string;
};

export type Plan =
  | { ok: false; error: string }
  | {
      ok: true;
      status: CaseStatus;
      data: Record<string, unknown>;
      event: { type: string; fromStatus: CaseStatus | null; toStatus: CaseStatus | null; note: string | null };
    };

const SEVERITIES = ["LOW", "MODERATE", "HIGH", "URGENT"];
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
const dayToDate = (value: string) => new Date(value + "T00:00:00.000Z");
const clean = (value: unknown, max = 600) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : "");
const whole = (value: unknown) => (value === undefined || value === null || value === "" ? undefined : Number(value));

/** Whether an update may still be recorded on a case in this status. */
export const isActive = (status: CaseStatus) => status === "OPEN" || status === "MONITORING";

/**
 * What an action does to a case, or why it cannot. `today` is the farm's calendar day (YYYY-MM-DD).
 * The result holds the fields to save, the case's new status, and the line to add to its history.
 */
export function planAction(snapshot: CaseSnapshot, action: CaseAction, input: ActionInput, today: string, now = new Date()): Plan {
  const note = clean(input.note);
  const fail = (error: string): Plan => ({ ok: false, error });
  const base: Record<string, unknown> = { lastActivityAt: now };

  // Counts and severity can be corrected alongside an update on a case that is still being worked.
  const counts = (): string | null => {
    const affected = whole(input.affectedCount);
    const deaths = whole(input.deathsCount);
    if (affected !== undefined) {
      if (!Number.isInteger(affected) || affected < 0 || affected > 1_000_000) return "Birds affected must be a whole number of 0 or more.";
      base.affectedCount = affected;
    }
    if (deaths !== undefined) {
      if (!Number.isInteger(deaths) || deaths < 0 || deaths > 1_000_000) return "Deaths must be a whole number of 0 or more.";
      if (deaths < snapshot.deathsCount) return `${snapshot.deathsCount} deaths are already recorded on this case; the count cannot go down.`;
      base.deathsCount = deaths;
    }
    if (input.severity !== undefined) {
      if (!SEVERITIES.includes(input.severity)) return "Severity must be Low, Moderate, High or Urgent.";
      base.severity = input.severity;
    }
    return null;
  };

  if (snapshot.status === "CLOSED" && action !== "reopen") return fail("This case is closed. Reopen it, with a reason, to add to it.");

  switch (action) {
    case "note": {
      if (!note) return fail("Write what you saw or did.");
      const problem = isActive(snapshot.status) ? counts() : null;
      if (problem) return fail(problem);
      const flagging = input.notifiable === true && !snapshot.notifiable;
      if (flagging) base.notifiable = true;
      return { ok: true, status: snapshot.status, data: base, event: { type: flagging ? "FLAGGED" : "NOTE", fromStatus: null, toStatus: null, note: flagging ? note + " (Flagged as a suspected notifiable disease.)" : note } };
    }

    case "monitor": {
      if (snapshot.status !== "OPEN") return fail("Only an open case can be moved to monitoring.");
      if (!isDay(input.nextReviewAt)) return fail("Choose the date you will look at this case again.");
      if (input.nextReviewAt < today) return fail("The next review date cannot be in the past.");
      const problem = counts();
      if (problem) return fail(problem);
      return { ok: true, status: "MONITORING", data: { ...base, status: "MONITORING", nextReviewAt: dayToDate(input.nextReviewAt) }, event: { type: "STATUS", fromStatus: "OPEN", toStatus: "MONITORING", note: `Next review ${input.nextReviewAt}.${note ? " " + note : ""}` } };
    }

    case "escalate": {
      if (snapshot.status !== "MONITORING") return fail("Only a case being monitored can be moved back to open.");
      if (!note) return fail("Say what has got worse.");
      const problem = counts();
      if (problem) return fail(problem);
      return { ok: true, status: "OPEN", data: { ...base, status: "OPEN", nextReviewAt: null }, event: { type: "STATUS", fromStatus: "MONITORING", toStatus: "OPEN", note } };
    }

    case "resolve": {
      if (!isActive(snapshot.status)) return fail("Only an open or monitored case can be resolved.");
      if (!input.outcome || !Object.hasOwn(OUTCOMES, input.outcome)) return fail("Choose how the case ended.");
      if ((snapshot.movementRestricted || snapshot.isolationRecommended) && !input.liftRestrictions)
        return fail("This case still has isolation or movement restrictions. Confirm that they are lifted before resolving it.");
      const problem = counts();
      if (problem) return fail(problem);
      const data: Record<string, unknown> = {
        ...base, status: "RESOLVED", outcome: input.outcome, resolvedAt: now, nextReviewAt: null,
        movementRestricted: false, isolationRecommended: false,
      };
      const diagnosis = clean(input.confirmedDiagnosis, 200);
      if (diagnosis) data.confirmedDiagnosis = diagnosis;
      const label = OUTCOMES[input.outcome as Outcome];
      return { ok: true, status: "RESOLVED", data, event: { type: "STATUS", fromStatus: snapshot.status, toStatus: "RESOLVED", note: `${label}.${diagnosis ? " Diagnosis: " + diagnosis + "." : ""}${note ? " " + note : ""}` } };
    }

    case "close": {
      if (snapshot.status !== "RESOLVED") return fail("Resolve the case before closing it.");
      if (snapshot.pendingTests > 0) return fail(`${snapshot.pendingTests} diagnostic result${snapshot.pendingTests === 1 ? " is" : "s are"} still pending. Record the result before closing.`);
      // A suspected notifiable disease is closed only once it has been reported to Veterinary Services.
      if (snapshot.notifiable && !snapshot.reported) return fail("This case is flagged as a suspected notifiable disease. Record the report to Veterinary Services before closing.");
      return { ok: true, status: "CLOSED", data: { ...base, status: "CLOSED", closedAt: now }, event: { type: "STATUS", fromStatus: "RESOLVED", toStatus: "CLOSED", note: note || null } };
    }

    case "reopen": {
      if (snapshot.status !== "RESOLVED" && snapshot.status !== "CLOSED") return fail("Only a resolved or closed case can be reopened.");
      if (!note) return fail("Say why the case is being reopened.");
      return {
        ok: true, status: "OPEN",
        data: { ...base, status: "OPEN", closedAt: null, resolvedAt: null, outcome: null, nextReviewAt: null, reopenedCount: { increment: 1 } },
        event: { type: "STATUS", fromStatus: snapshot.status, toStatus: "OPEN", note },
      };
    }

    case "report": {
      if (!isDay(input.reportedToAuthorityAt)) return fail("Enter the date it was reported.");
      if (input.reportedToAuthorityAt > today) return fail("The report date cannot be in the future.");
      const reference = clean(input.authorityReference, 120);
      return {
        ok: true, status: snapshot.status,
        data: { ...base, notifiable: true, reportedToAuthorityAt: dayToDate(input.reportedToAuthorityAt), authorityReference: reference || null },
        event: { type: "REPORTED", fromStatus: null, toStatus: null, note: `Reported to Veterinary Services on ${input.reportedToAuthorityAt}${reference ? " (reference " + reference + ")" : ""}.${note ? " " + note : ""}` },
      };
    }
  }
}

/** What needs attention on a case that is still active: a review that is due, or no word on it for a while. */
export function attention(c: { status: string; nextReviewAt?: string | Date | null; lastActivityAt?: string | Date | null; notifiable?: boolean; reportedToAuthorityAt?: string | Date | null }, today: string, staleDays = 3): string[] {
  const out: string[] = [];
  if (c.status !== "OPEN" && c.status !== "MONITORING") return out;
  const day = (v: string | Date) => (typeof v === "string" ? v : v.toISOString()).slice(0, 10);
  if (c.notifiable && !c.reportedToAuthorityAt) out.push("Suspected notifiable disease: not yet reported");
  if (c.status === "MONITORING" && c.nextReviewAt) {
    const due = day(c.nextReviewAt);
    if (due < today) out.push("Review overdue");
    else if (due === today) out.push("Review due today");
  }
  if (c.status === "OPEN" && c.lastActivityAt) {
    const gap = Math.floor((Date.parse(today + "T00:00:00Z") - Date.parse(day(c.lastActivityAt) + "T00:00:00Z")) / 86_400_000);
    if (gap >= staleDays) out.push(`No update for ${gap} days`);
  }
  return out;
}
