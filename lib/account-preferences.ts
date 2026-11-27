import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const preferenceSchema = z.strictObject({
  farmAlertEmail: z.boolean(),
  farmReportEmail: z.boolean(),
  allowVisionImages: z.boolean(),
});
export type AccountPreferences = z.infer<typeof preferenceSchema>;
const defaults: AccountPreferences = { farmAlertEmail: false, farmReportEmail: false, allowVisionImages: true };

export const accountPreferenceKey = (userId: string) => "ACCOUNT_PREFERENCES_V1::" + userId;

export async function accountPreferences(farmId: string, userId: string): Promise<AccountPreferences> {
  const row = await prisma.setting.findUnique({
    where: { farmId_key: { farmId, key: accountPreferenceKey(userId) } }, select: { value: true },
  });
  if (!row) return defaults;
  try {
    const data = preferenceSchema.safeParse(JSON.parse(row.value));
    if (data.success) return data.data;
  } catch { /* malformed stored values use a privacy-preserving default */ }
  return { ...defaults, allowVisionImages: false };
}
