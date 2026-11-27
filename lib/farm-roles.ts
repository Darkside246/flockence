export const farmRoles = ["OWNER", "MANAGER", "WORKER", "READ_ONLY"] as const;
export type FarmRole = typeof farmRoles[number];
export type InviteRole = Exclude<FarmRole, "OWNER">;

export const farmRoleLabels: Record<FarmRole, string> = {
  OWNER: "Owner", MANAGER: "Supervisor", WORKER: "Farm Hand", READ_ONLY: "Read Only",
};

export function canInviteRole(actor: string, role: string): role is InviteRole {
  return (actor === "OWNER" && role === "MANAGER") ||
    ((actor === "OWNER" || actor === "MANAGER") && (role === "WORKER" || role === "READ_ONLY"));
}

/**
 * Who may change what (owner, 2026-11-27):
 *  - Farm-wide settings, integrations, API keys, camera sign-in, schedules, daily email and the catalogues (products,
 *    feed, suppliers, prices, storage, recurring costs): the Owner only.
 *  - Pens (size, equipment, camera-to-pen), flocks, records, sales and expenses, and Farm Hand / Read Only members:
 *    Owners and Supervisors.
 *  - Day-to-day records (deaths, feed, eggs, weights, daily checks, health notes, tasks, Vision photo checks): Owners,
 *    Supervisors and Farm Hands.
 *  - Everyone, Read Only included: their own name, password and email choices, and signing themselves out.
 */
export const SETTINGS_ROLES = ["OWNER"] as const satisfies readonly FarmRole[];
export const PEN_ROLES = ["OWNER", "MANAGER"] as const satisfies readonly FarmRole[];
export const RECORD_ROLES = ["OWNER", "MANAGER", "WORKER"] as const satisfies readonly FarmRole[];
export const canChangeSettings = (role: string | null | undefined) => role === "OWNER";
