import { NextResponse } from "next/server";
import { z } from "zod";
import { SETTINGS_ROLES } from "@/lib/farm-roles";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { isTrustedAppOrigin } from "@/lib/request-origin";
import { editableCategories, loadEmailTemplates, saveEmailTemplates } from "@/lib/email-template-store";
import { EMAIL_TEMPLATE_LIMITS, isEmailCategory } from "@/lib/email-templates.mjs";

const headers = { "Cache-Control": "private, no-store" };
const field = (max: number) => z.string().max(max * 2).optional();
const saveSchema = z.object({
  templates: z.record(z.string().refine(isEmailCategory), z.object({
    subject: field(EMAIL_TEMPLATE_LIMITS.subject),
    intro: field(EMAIL_TEMPLATE_LIMITS.intro),
    footer: field(EMAIL_TEMPLATE_LIMITS.footer),
  })),
});

/** Settings > Email: the owner's templates and whether outgoing mail is configured on this server (never the key). */
export async function GET(request: Request) {
  const access = await currentUserOrRoleResponse(request, SETTINGS_ROLES);
  if (access.response) return access.response;
  try {
    const farmId = access.user.farmId;
    return NextResponse.json({
      categories: editableCategories(farmId),
      templates: await loadEmailTemplates(farmId),
      delivery: { configured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM), welcomeOn: process.env.FLOCKENCE_WELCOME_EMAIL === "on" },
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Email templates could not be loaded." }, { status: 500, headers });
  }
}

export async function PUT(request: Request) {
  const access = await currentUserOrRoleResponse(request, SETTINGS_ROLES);
  if (access.response) return access.response;
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  const input = saveSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Check the email templates and try again." }, { status: 400, headers });
  try {
    const farmId = access.user.farmId;
    await saveEmailTemplates(farmId, input.data.templates);
    return NextResponse.json({ templates: await loadEmailTemplates(farmId) }, { headers });
  } catch {
    return NextResponse.json({ error: "Email templates could not be saved." }, { status: 500, headers });
  }
}
