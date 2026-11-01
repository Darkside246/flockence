# Bringing Flockence to Oriya's security level (plan, 2026-11-01)

Owner: "Flockence should match the security of Oriya, or higher, with the same setup." This compares the two, item by
item, and sets the order of work. Status: ✅ already equal or better · 🔶 partly · ❌ missing.

| Area | Oriya today | Flockence today | Status |
| --- | --- | --- | --- |
| Front door | Cloudflare (Full strict) + Caddy with the Cloudflare Origin Certificate | `Caddyfile.example` uses Let's Encrypt (needs port 80) | ❌ |
| Server firewall | DigitalOcean Cloud Firewall: 443 from Cloudflare only, 22; port 80 closed | Not set up yet (new droplet) | ❌ |
| Passwords | Salted hashes | scrypt, salted | ✅ |
| Sign-in tokens | Only fingerprints stored | Only SHA-256 fingerprints stored | ✅ |
| Sign-in attempts | Limited | Limited per email (8 per 15 min) | ✅ |
| Second factor (MFA) | Encrypted TOTP + recovery codes for sensitive access | None | ❌ |
| Session length / sign out everywhere | Revocable sessions | 30 days, no "sign out everywhere" | 🔶 |
| Personal data at rest | Field-level encryption (names, phones, addresses, notes) | Plain text (customers, orders, delivery addresses) | ❌ |
| Camera / video | n/a | Hardened 2026-11-01 (docs/CAMERA_SECURITY.md) | ✅ |
| Link between the two apps | Signed per request (HMAC, 5 min, once) | Same | ✅ |
| Uploaded files | Judged by their real bytes before storing (`fileScreen`) | Vision uploads checked by declared type only | 🔶 |
| Content Security Policy | Set | Not set | ❌ |
| Audit log | Activity log of who did what | AuditLog on some actions; sign-ins not logged | 🔶 |
| Security alerts | Guardian + Security Center | None | ❌ |
| Backups | Encrypted, off the server, verified | Backup verify script; off-server copy not set | 🔶 |
| Secrets reaching the app | Reviewed allow-list (`prepare-runtime-env.mjs`) | Whole `.env` | 🔶 |
| Running as | Docker, non-root | `npm run start` / Python on the host | 🔶 |
| Automatic security updates | On | Not set (new droplet) | ❌ |

## Order of work

1. **Server setup like Oriya's** (no code risk, biggest effect): `Caddyfile.cloudflare`, firewall rules, Cloudflare rate
   limit for `/api/cameras/*`, Cloudflare Access recommended, automatic updates, swap. Adapted from Oriya's settled
   setup (`docs/notes/DROPLET_SERVER_SETUP.md` in the Oriya repo).
2. **Second factor (TOTP) for owner and manager**, with recovery codes; secrets encrypted.
3. **Encrypt personal data at rest**: customer names, phones, emails, delivery addresses, order notes (AES-256-GCM,
   key from the environment), with a one-time migration of existing rows and no change to what people see.
4. **Content Security Policy**, sign-in audit, "sign out everywhere", shorter idle sessions.
5. **Uploads judged by their real bytes**, as Oriya does.
6. **Docker, non-root, and a reviewed environment allow-list**; encrypted off-server backups; security alerts.

Each step is tested before it is pushed, and none may cut the farm off: existing sign-ins, cameras and the Oriya link
keep working throughout.
