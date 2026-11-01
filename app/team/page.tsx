"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/nav";
import { useSession } from "@/components/auth-gate";

type UserRole = "OWNER" | "MANAGER" | "WORKER" | "READ_ONLY";
type TeamMember = { id: string; name: string; email: string; role: UserRole; createdAt: string };

async function readJson(response: Response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || "The request could not be completed.");
  return data;
}

const roleLabels: Record<UserRole, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  WORKER: "Farm worker",
  READ_ONLY: "Read only",
};

export default function TeamPage() {
  const session = useSession();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("WORKER");
  const [inviteExpiry, setInviteExpiry] = useState("7");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [inviteSaving, setInviteSaving] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  const canAssignManagement = session?.role === "OWNER";
  const options = useMemo<UserRole[]>(
    () => canAssignManagement ? ["OWNER", "MANAGER", "WORKER", "READ_ONLY"] : ["WORKER", "READ_ONLY"],
    [canAssignManagement],
  );

  async function load() {
    setLoading(true);
    try {
      const data = await readJson(await fetch("/api/team", { cache: "no-store" }));
      setMembers(Array.isArray(data.users) ? data.users : []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the farm team.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function createInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteSaving(true);
    setError("");
    setMessage("");
    setInviteCode("");
    setCopyMessage("");
    try {
      const data = await readJson(await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: inviteRole, expiresInDays: Number(inviteExpiry) }),
      }));
      setInviteCode(data.inviteCode);
      setInviteExpiresAt(data.expiresAt);
      setMessage("Invitation created. Copy the code now and share it securely. It can only be redeemed once.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create an invitation.");
    } finally {
      setInviteSaving(false);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopyMessage("Invitation code copied.");
    } catch {
      setCopyMessage("Copy is unavailable in this browser. Select and copy the code manually.");
    }
  }

  async function changeRole(member: TeamMember, role: UserRole) {
    if (role === member.role) return;
    setSavingId(member.id);
    setError("");
    setMessage("");
    try {
      await readJson(await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, role }),
      }));
      setMembers((current) => current.map((row) => row.id === member.id ? { ...row, role } : row));
      setMessage(`${member.name}'s farm role is now ${roleLabels[role]}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that role.");
    } finally {
      setSavingId("");
    }
  }

  return <div className="shell">
    <header className="topbar"><div className="brand"><div><h1>Farm team</h1><p>Manage access to production and business records.</p></div><span className="badge">ACCESS CONTROL</span></div></header>
    <Nav/>
    <main className="main">
      <section className="dashboard-head">
        <div><div className="hero-kicker">Workspace administration</div><h2>People and permissions</h2><p>Give each person the access they need to do their work, without giving everyone control of the farm.</p></div>
      </section>
      {error && <section className="section card" role="alert"><strong>Could not complete that action</strong><p>{error}</p></section>}
      {message && <section className="section card" role="status"><strong>{message}</strong></section>}

      <section className="section dashboard-grid">
        <div className="card metric-card"><div className="metric-label">Team members</div><div className="metric-value">{members.length}</div><div className="metric-foot">accounts attached to this farm</div></div>
        <div className="card metric-card"><div className="metric-label">Owners</div><div className="metric-value">{members.filter((member) => member.role === "OWNER").length}</div><div className="metric-foot">full farm control</div></div>
        <div className="card metric-card"><div className="metric-label">Managers</div><div className="metric-value">{members.filter((member) => member.role === "MANAGER").length}</div><div className="metric-foot">operational administration</div></div>
        <div className="card metric-card"><div className="metric-label">Field users</div><div className="metric-value">{members.filter((member) => member.role === "WORKER").length}</div><div className="metric-foot">record normal farm work</div></div>
      </section>

      <section className="section card">
        <div className="section-head"><div><div className="hero-kicker">Access directory</div><h3>Farm members</h3><p>Changes take effect on the next API request. At least one owner must remain assigned.</p></div></div>
        {loading ? <div className="empty">Loading farm members…</div> : members.length === 0 ? <div className="empty"><strong>No team members are configured.</strong><span>Complete the initial owner setup before inviting the rest of the farm team.</span></div> : <div className="list">
          {members.map((member) => <article className="card" key={member.id}>
            <div className="row" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(120px,1fr) minmax(160px,1fr)", alignItems: "center" }}>
              <div><strong>{member.name}{member.id === session?.id ? " · You" : ""}</strong><span>{member.email}</span></div>
              <div><strong>{roleLabels[member.role]}</strong><span>Joined {new Date(member.createdAt).toLocaleDateString()}</span></div>
              <div><label>Access role<select value={member.role} disabled={savingId === member.id || member.id === session?.id || (session?.role === "MANAGER" && (member.role === "OWNER" || member.role === "MANAGER"))} onChange={(event) => void changeRole(member, event.target.value as UserRole)}>
                {!options.includes(member.role) && <option value={member.role}>{roleLabels[member.role]}</option>}
                {options.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}
              </select></label></div>
            </div>
            {savingId === member.id && <p className="muted">Saving access change…</p>}
            {member.id === session?.id && <p className="muted">Your own role is locked here to reduce the chance of locking yourself out. Ask another owner to change it.</p>}
          </article>)}
        </div>}
      </section>

      <section className="section card">
        <div className="section-head"><div><div className="hero-kicker">Invite securely</div><h3>Invite a team member</h3><p>Create a single-use invitation for this farm. The role is assigned automatically when the person signs up.</p></div></div>
        <form className="form grid2" onSubmit={createInvite}>
          <label>Assign role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as UserRole)}>
            {options.filter((role) => role !== "OWNER").map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
          </select></label>
          <label>Expires after<select value={inviteExpiry} onChange={(event) => setInviteExpiry(event.target.value)}>
            <option value="1">1 day</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option>
          </select></label>
          <button className="button button-primary" type="submit" disabled={inviteSaving}>{inviteSaving ? "Creating invitation…" : "Generate invitation"}</button>
        </form>
        {inviteCode && <div className="section">
          <label>One-time invitation code<input readOnly value={inviteCode} onFocus={(event) => event.currentTarget.select()}/></label>
          <div className="row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
            <span className="muted">Expires {new Date(inviteExpiresAt).toLocaleString()} · {roleLabels[inviteRole]}</span>
            <button className="button" type="button" onClick={() => void copyInvite()}>Copy code</button>
          </div>
          {copyMessage && <p className="notice" role="status">{copyMessage}</p>}
          <p className="muted">The full code is not stored in readable form and cannot be displayed again after you leave this page. Generate a new invite if it is lost.</p>
        </div>}
      </section>

      <section className="section card">
        <div className="section-head"><div><div className="hero-kicker">Role guide</div><h3>What each role can do</h3><p>Permissions are enforced by the API. Hiding a control in the interface is not the security boundary.</p></div></div>
        <div className="grid2">
          <div><strong>Owner</strong><p className="muted">Full farm access, including team roles, settings, financial configuration, stock setup and operational records.</p></div>
          <div><strong>Manager</strong><p className="muted">Manage most farm setup and operations. Cannot promote people to owner or manager.</p></div>
          <div><strong>Farm worker</strong><p className="muted">Record daily flock checks, mortality, weights, feed usage, egg collections and routine operational events.</p></div>
          <div><strong>Read only</strong><p className="muted">Review records and reports without submitting changes.</p></div>
        </div>
      </section>
    </main>
  </div>;
}
