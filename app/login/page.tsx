import { accountCaptchaMode, accountCaptchaSiteKey } from "@/lib/signup-captcha";
import { LoginForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm captchaSiteKey={accountCaptchaSiteKey()} captchaMode={accountCaptchaMode()} />;
}
