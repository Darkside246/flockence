import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/current-user";
import { AccountActions } from "@/components/account-actions";
import { Nav } from "@/components/nav";

export default async function AccountPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");
  let user;
  try { user = await requireCurrentUser(new Request("http://localhost", { headers: { cookie: cookieHeader } })); } catch { redirect("/login"); }
  return <div className="shell"><header className="topbar"><div className="brand"><div><div className="hero-kicker">Account</div><h1>{user!.name}</h1><p>{user!.email}</p></div><span className="badge">{user!.role}</span></div></header><Nav/><main className="main"><section className="card"><div className="section-head"><div><h3>Account security</h3><p>Your password is stored as a salted scrypt hash. Session and reset tokens are not stored in plaintext.</p></div></div><AccountActions/></section></main></div>;
}
