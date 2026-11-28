"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/nav";
import { useSession } from "@/components/auth-gate";

import { canInviteRole, farmRoleLabels as roleLabels, type FarmRole as UserRole, type InviteRole } from "@/lib/farm-roles";

type PendingInvitation = { id: string; email: string; role: InviteRole; expiresAt: string };
type TeamMember = { id: string; name: string; email: string; role: UserRole; createdAt: string };

async function readJson(response: Response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || "The request could not be completed.");
  return data;
}

export default function TeamPage() {
  const session = useSession();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [revokingId, setRevokingId] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("WORKER");
  const [inviteExpiry, setInviteExpiry] = useState("7");
  const [inviteSaving, setInviteSaving] = useState(false);

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
      setInvitations(Array.isArray(data.invitations) ? data.invitations : []);
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
    try {
      const data = await readJson(await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, expiresInDays: Number(inviteExpiry) }),
      }));
      setInvitations(current => [data.invitation, ...current]);
      setInviteEmail("");
      setMessage("Invitation sent to " + data.invitation.email + ".");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create an invitation.");
    } finally {
      setInviteSaving(false);
    }
  }

  async function revokeInvite(id: string) {
    setRevokingId(id);
    setError("");
    setMessage("");
    try {
      await readJson(await fetch("/api/team", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      }));
      setInvitations(current => current.filter(invite => invite.id !== id));
      setMessage("Invitation revoked.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not revoke this invitation.");
    } finally {
      setRevokingId("");
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
    <header className="topbar"><div className="brand"><div><h1>Farm team</h1><p>Manage access to production and business records. Give each person the access they need to do their work, without giving everyone control of the farm.</p></div><span className="badge">ACCESS CONTROL</span></div></header>
    <Nav/>
    <main className="main">
      {error && <section className="section card" role="alert"><strong>Could not complete that action</strong><p>{error}</p></section>}
      {message && <section className="section card" role="status"><strong>{message}</strong></section>}

      <section className="section dashboard-grid">
        <div className="card metric-card"><div className="metric-label">Team members</div><div className="metric-value">{members.length}</div><div className="metric-foot">accounts attached to this farm</div></div>
        <div className="card metric-card"><div className="metric-label">Owners</div><div className="metric-value">{members.filter((member) => member.role === "OWNER").length}</div><div className="metric-foot">full farm control</div></div>
        <div className="card metric-card"><div className="metric-label">Supervisors</div><div className="metric-value">{members.filter((member) => member.role === "MANAGER").length}</div><div className="metric-foot">operational administration</div></div>
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
        <div className="section-head"><div><div className="hero-kicker">Invite securely</div><h3>Invite a team member</h3><p>Send a single-use link. The recipient enters their name and sets a password to join this farm.</p></div></div>
        <form className="form grid2" onSubmit={createInvite}>
          <label>Recipient email<input type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} maxLength={254} required /></label>
          <label>Assign role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as UserRole)}>
            {options.filter((role) => role !== "OWNER").map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
          </select></label>
          <label>Expires after<select value={inviteExpiry} onChange={(event) => setInviteExpiry(event.target.value)}>
            <option value="1">1 day</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option>
          </select></label>
          <button className="button button-primary" type="submit" disabled={inviteSaving}>{inviteSaving ? "Sending invitation…" : "Send email invitation"}</button>
        </form>
        {invitations.length > 0 && <div className="section">
          <h4>Pending invitations</h4>
          {invitations.map(invitation => <div key={invitation.id} className="row">
            <div><strong>{invitation.email}</strong><span>{roleLabels[invitation.role]} · Expires {new Date(invitation.expiresAt).toLocaleString()}</span></div>
            {canInviteRole(session?.role ?? "", invitation.role) && <button type="button" className="button" disabled={Boolean(revokingId)} onClick={() => void revokeInvite(invitation.id)}>{revokingId === invitation.id ? "Revoking…" : "Revoke invitation"}</button>}
          </div>)}
        </div>}
      </section>

      <section className="section card">
        <div className="section-head"><div><div className="hero-kicker">Role guide</div><h3>What each role can do</h3><p>Permissions are enforced by the API. Hiding a control in the interface is not the security boundary.</p></div></div>
        <div className="grid2">
          <div><strong>Owner</strong><p className="muted">Full farm access, including team roles, settings, financial configuration, stock setup and operational records.</p></div>
          <div><strong>Supervisor</strong><p className="muted">Manage most farm setup and operations. Can invite Farm Hands and Read Only users. Owner and Supervisor role changes require an Owner.</p></div>
          <div><strong>Farm Hand</strong><p className="muted">Record daily flock checks, mortality, weights, feed usage, egg collections and routine operational events.</p></div>
          <div><strong>Read Only</strong><p className="muted">Review records and reports without submitting changes.</p></div>
        </div>
      </section>
    </main>
  </div>;
}
