import { SignupForm } from "@/components/auth-form";

import Link from "next/link";
import { freeSignupEnabled } from "@/lib/free-signup-enabled";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  if (freeSignupEnabled()) return <main className="auth-shell"><section className="auth-card"><div className="auth-heading"><h1>Join Flockence</h1><p>Create your own farm or use an invitation to join an existing one.</p></div><div className="form"><Link href="/signup/free" className="button button-primary">Start a Free farm</Link><Link href="/signup/invited">Use an invitation or owner setup code</Link><Link href="/login">Back to sign in</Link></div></section></main>;
  return <SignupForm />;
}
