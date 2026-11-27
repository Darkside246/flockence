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
