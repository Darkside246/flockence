import { accountCaptchaMode } from "@/lib/signup-captcha";
import { notFound } from "next/navigation";
import { freeSignupEnabled } from "@/lib/free-signup-enabled";
import { FreeSignupForm } from "@/components/free-signup-form";

export const dynamic = "force-dynamic";
export default function FreeSignupPage() {
  if (!freeSignupEnabled()) notFound();
  return <FreeSignupForm captchaSiteKey={process.env.RECAPTCHA_SITE_KEY?.trim() ?? ""} captchaMode={accountCaptchaMode()} />;
}
