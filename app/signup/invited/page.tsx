import { accountCaptchaSiteKey } from "@/lib/signup-captcha";
import { SignupForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return <SignupForm captchaSiteKey={accountCaptchaSiteKey()} />;
}
