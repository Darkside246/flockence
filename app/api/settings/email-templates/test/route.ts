import { NextResponse } from "next/server";
import { z } from "zod";
import { SETTINGS_ROLES } from "@/lib/farm-roles";
import { currentUserOrRoleResponse } from "@/lib/current-user";
import { isTrustedAppOrigin } from "@/lib/request-origin";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendEmailWithResult } from "@/lib/mail";
import { editableCategories, loadEmailTemplate } from "@/lib/email-template-store";
import { applyEmailTemplate, isEmailCategory, sampleMessage, type EmailCategoryId } from "@/lib/email-templates.mjs";

const headers = { "Cache-Control": "private, no-store" };
/** A plain next step for the reasons Resend gives most often. */
function hintFor(status: number | null, reason: string | null) {
  const text = (reason ?? "").toLowerCase();
  if (status === 401 || text.includes("api key")) return " The administrator should replace RESEND_API_KEY in the server environment with a key that starts with re_, then restart.";
  if (text.includes("domain") || text.includes("verify")) return " Check that the sending domain shows Verified in Resend and that RESEND_FROM uses that domain.";
  if (status === 429) return " Too many emails at once; try again in a minute.";
  return "";
}

const schema = z.object({ category: z.string().refine(isEmailCategory) });

/**
 * "Send me a test": the saved template for one category, applied to a sample message, sent only to the signed-in
 * owner's own sign-in email. Ten tests an hour per owner.
 */
export async function POST(request: Request) {
  const access = await currentUserOrRoleResponse(request, SETTINGS_ROLES);
  if (access.response) return access.response;
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
  const input = schema.safeParse(await request.json().catch(() => null));
  const user = access.user;
  if (!input.success || !editableCategories(user.farmId).some((c) => c.id === input.data.category)) {
    return NextResponse.json({ error: "Choose one of the email types." }, { status: 400, headers });
  }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    return NextResponse.json({ sent: false, error: "Email is not set up on this server yet. The administrator adds RESEND_API_KEY and RESEND_FROM to the server environment." }, { status: 503, headers });
  }
  const limit = await checkRateLimit("email-template-test:" + user.id, 10, 60 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many test emails. Try again later." }, { status: 429, headers });
  const category = input.data.category as EmailCategoryId;
  let base: URL;
  try { base = new URL(process.env.APP_URL ?? "https://flockence.com"); } catch { base = new URL("https://flockence.com"); }
  const sample = sampleMessage(category, base.href);
  if (!sample) return NextResponse.json({ error: "Choose one of the email types." }, { status: 400, headers });
  const { template, farm } = await loadEmailTemplate(category, user.farmId);
  const applied = applyEmailTemplate(category, sample, template, { farm });
  const message = { ...applied, subject: "[Test] " + applied.subject };
  try {
    const sent = await sendEmailWithResult(user.email, message);
    if (!sent.ok) return NextResponse.json({ sent: false, error: "Resend did not accept the email: " + (sent.reason ?? "no reason given") + hintFor(sent.status, sent.reason) }, { status: 502, headers });
    return NextResponse.json({ sent: true, to: user.email }, { headers });
  } catch {
    return NextResponse.json({ sent: false, error: "The email service did not answer. Try again in a minute." }, { status: 502, headers });
  }
}
