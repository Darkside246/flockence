import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { AccountPreferencesForm } from "@/components/account-preferences";
import { accountPreferences } from "@/lib/account-preferences";
import { farmRoleLabels, type FarmRole } from "@/lib/farm-roles";
import { AccountSessions } from "@/components/account-sessions";
import { AccountActions } from "@/components/account-actions";
import { Nav } from "@/components/nav";

export default async function AccountPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");
  let user;
  try { user = await requireCurrentUser(new Request("http://localhost", { headers: { cookie: cookieHeader } })); } catch { redirect("/login"); }
  const preferences = await accountPreferences(user!.farmId, user!.id);
  const viaOriya = user!.email.endsWith("@oriya.invalid");
  return <div className="shell"><header className="topbar"><div className="brand"><div><div className="hero-kicker">Account</div><h1>{user!.name}</h1><p>{user!.email.endsWith("@oriya.invalid") ? "Signed in through Oriya" : user!.email}</p></div><span className="badge">{farmRoleLabels[user!.role as FarmRole]}</span></div></header><Nav/><main className="main"><section className="card"><div className="section-head"><div><h3>Account security</h3><p>{viaOriya ? "Manage your sign-in email and password in your Oriya account." : "Your sign-in email is shown above. Use the password reset link on the sign-in page if you need a new password."}</p></div></div><AccountActions/></section><AccountPreferencesForm initialName={user!.name} initialPreferences={preferences}/><AccountSessions/></main></div>;
}
