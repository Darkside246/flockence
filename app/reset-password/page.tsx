import { ResetPasswordForm } from "@/components/auth-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  return params.token ? <ResetPasswordForm token={params.token} /> : <ResetPasswordForm token="" />;
}
