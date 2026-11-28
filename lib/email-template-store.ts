import { prisma } from "@/lib/prisma";
import { DEFAULT_FARM_ID, runAsFarm } from "@/lib/farm-scope";
import {
  cleanTemplateField, emailCategories, emailCategory, emailTemplateFields, emailTemplateKey,
  type EmailCategoryId, type EmailTemplateText,
} from "@/lib/email-templates.mjs";

/**
 * Saved email templates live in the farm's Setting rows (keys "email_template.<category>.<field>"), so no schema change.
 * Account emails (sign-up verification, welcome, password reset) use the home farm's templates: they go out before or
 * outside a farm. Farm emails (team invitation, Vision report and alert) use the sending farm's own templates.
 */
export function templateFarmFor(category: EmailCategoryId, farmId?: string | null) {
  return emailCategory(category)?.group === "account" ? DEFAULT_FARM_ID : farmId ?? null;
}

/** The categories a farm's owner may edit: the home farm owns the account emails too. */
export function editableCategories(farmId: string) {
  return emailCategories.filter((c) => c.group === "farm" || farmId === DEFAULT_FARM_ID);
}

export async function loadEmailTemplates(farmId: string): Promise<Record<string, EmailTemplateText>> {
  return runAsFarm(farmId, async () => {
    const rows = await prisma.setting.findMany({ where: { farmId, key: { startsWith: "email_template." } }, select: { key: true, value: true } });
    const out: Record<string, EmailTemplateText> = {};
    for (const { key, value } of rows) {
      const [, category, field] = key.split(".");
      if (!emailCategory(category) || !emailTemplateFields.includes(field as never)) continue;
      (out[category] ??= {})[field as keyof EmailTemplateText] = value;
    }
    return out;
  });
}

/** One category's saved template and the farm name for {farm}. Never throws: a template that cannot load never stops an email. */
export async function loadEmailTemplate(category: EmailCategoryId, farmId?: string | null): Promise<{ template: EmailTemplateText | null; farm: string }> {
  const owner = templateFarmFor(category, farmId);
  if (!owner) return { template: null, farm: "" };
  try {
    const [all, farm] = await Promise.all([
      loadEmailTemplates(owner),
      runAsFarm(owner, () => prisma.farm.findUnique({ where: { id: owner }, select: { name: true } })),
    ]);
    return { template: all[category] ?? null, farm: farm?.name ?? "" };
  } catch {
    return { template: null, farm: "" };
  }
}

/** Save a farm's templates. Empty fields are removed so the default wording comes back. */
export async function saveEmailTemplates(farmId: string, templates: Partial<Record<EmailCategoryId, EmailTemplateText>>) {
  const allowed = new Set(editableCategories(farmId).map((c) => c.id));
  return runAsFarm(farmId, () => prisma.$transaction(async (tx) => {
    for (const [category, fields] of Object.entries(templates) as [EmailCategoryId, EmailTemplateText][]) {
      if (!allowed.has(category)) continue;
      for (const field of emailTemplateFields) {
        const key = emailTemplateKey(category, field);
        const value = cleanTemplateField(field, fields?.[field] ?? "");
        if (value) await tx.setting.upsert({ where: { farmId_key: { farmId, key } }, create: { farmId, key, value }, update: { value } });
        else await tx.setting.deleteMany({ where: { farmId, key } });
      }
    }
  }));
}
