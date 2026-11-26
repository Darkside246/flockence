import { accountCaptchaSiteKey } from "@/lib/signup-captcha";
import { ForgotPasswordForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm captchaSiteKey={accountCaptchaSiteKey()} />;
}
