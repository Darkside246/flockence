# Flockence Rebrand and Oriya Integration Handoff

**Prepared:** 31 October 2026  
**Repository:** `Darkside246/chicken-op` (private)  
**Product name:** Flockence  
**Parent platform:** Oriya  
**Product descriptor:** Intelligent Poultry Management  
**Tagline:** Every flock. Every decision. Connected.  
**Brand signature:** Powered by Oriya.

---

## 1. Why this document exists

This is the working handoff for a second engineering agent continuing the transition from **Chicken Op** to **Flockence**.

The work is a product rebrand and a controlled continuation of the poultry application. It is not permission to rewrite the application, replace the Oriya integration, change database identifiers indiscriminately, deploy production, or merge unfinished work.

The immediate goal is to make Flockence the consistent product identity across the application while preserving all existing production functionality, farm records, integrations, security boundaries and browser-side state.

The wider goal is to make Flockence a first-class specialist product in the Oriya ecosystem:

- Flockence owns and manages poultry operational truth.
- Oriya provides shared intelligence, business automation, customer communications and connected business capabilities.
- Oriya must retrieve live poultry information from Flockence rather than maintain a competing copy of poultry inventory or production facts.
- The product should work for a small independent farmer and scale in capability for larger commercial poultry operations.

## 2. GitHub repository and branch state

### Correct repository

`Darkside246/chicken-op`

This is a separate private repository. Do not confuse it with `Darkside246/WhatchatAI`, which is a different Oriya/WhatsApp project.

### Relevant baseline

The rebrand branch was created from the latest consolidated broiler/layer development branch:

- **Base branch:** `feat/chicken-op-broiler-layer-ux-2026-10-28`
- **Base commit when branched:** `4b348226134b25b52c4f0424e10cd25e92b1a30b`
- **Rebrand branch:** `rebrand/flockence-2026-10-31`
- **Branch state:** active; the rebrand PR is receiving incremental documentation and integration commits. Always inspect the latest branch HEAD before continuing.

The source baseline is the head of draft PR #4, titled **Draft: consolidate Chicken Op broiler and layer workflows**. The rebrand branch is intentionally a child of that feature branch. A rebrand PR should target the feature branch, not `main`, otherwise it will appear to include the entire unmerged poultry feature baseline.

### Other branches and pull requests to understand

- PR #4: consolidated broiler/layer functionality and UX, still draft at the time of this handoff.
- PR #5: security follow-up for password-reset URL trust and a source-level security review. Its base commit is older than the latest PR #4 feature head. Do not blindly merge PR #5. Review its password-reset correction and selectively port the required fix onto the current branch, with tests.
- Other historical feature/security branches exist. Review their content and dependency relationships before cherry-picking anything. Do not merge divergent application histories wholesale.

### Current state of this effort

A separate branch `rebrand/flockence-2026-10-31` has been created and a first branding pass has been committed there. No production deployment, DNS change, database migration, or merge to the baseline has been performed.

## 3. Brand direction

### Official working identity

**Flockence**  
**Intelligent Poultry Management**  
*Every flock. Every decision. Connected.*  
**Powered by Oriya.**

Flockence is a specialist poultry production and enterprise operations platform. It should not be presented as only a chicken counter, a broiler batch tracker, or a farm diary.

### Target customer and positioning

Serve both ends of the market:

1. **Independent and small farmers:** simple onboarding, plain language, a mobile-first daily workflow, low-friction recordkeeping, clear alerts and practical guidance.
2. **Growing and commercial operators:** deeper production controls, multiple houses and flocks, audit trails, procurement, inventory, workforce management, traceability, financial controls, analytics and role-based administration.

Do not overwhelm small operators with enterprise configuration by default. Use progressive disclosure, sensible defaults and role/plan-aware capability exposure. Advanced functionality should be discoverable without making routine farm work complicated.

### Brand voice

- Practical, knowledgeable, calm and trustworthy.
- Clear language that farmers and workers can understand.
- Commercially and operationally credible.
- No exaggerated AI claims.
- Do not imply that the platform diagnoses animal disease or certifies legal compliance.
- Distinguish recorded facts, estimates, projections, warnings and recommendations.

### Initial colour direction

These are proposed brand tokens, not yet a fully implemented design system:

| Token | Colour | Intended use |
|---|---|---|
| Forest | `#172C20` | Primary dark surface and wordmark |
| Growth | `#7CB733` | Primary action and active state |
| Fresh | `#A8CE76` | Supporting highlight |
| Harvest | `#E0A21E` | Caution/harvest accent, not generic success |
| Neutral | `#F0F2EB` | Light background |

The existing app already has a theme system with five accessibility themes. Do not replace it with a single hardcoded palette. Introduce Flockence brand tokens through the existing semantic theme architecture and verify contrast in every theme.

### Logo direction

Create an original, recognizable mark that can work as a favicon, PWA icon, sidebar mark and full wordmark. A good direction is an abstract feather/wing or flock-inspired geometric form combined with connection/growth cues.

Avoid cartoon chickens, barn clip-art, generic egg icons as the main mark, and overly detailed artwork that disappears at small sizes. Do not use a third-party logo as a template to copy.

## 4. Domain and application architecture

### Proposed hostnames

- Product/marketing entry point: `flockence.oriya.si`
- Application: `app.flockence.oriya.si`

These are proposals only. Domain registration, DNS ownership, Cloudflare records, TLS, reverse proxy and production deployment have **not** been verified or changed.

Do not change `APP_URL`, password-reset URLs, cookies, callback URLs, Caddy/Nginx production configuration or DNS until the final hostname is confirmed and a coordinated deployment plan exists.

### Product relationship

Oriya is the parent intelligence and business platform. Flockence is the poultry vertical.

Flockence should retain an independently understandable product identity, but use Oriya for shared capabilities where integration is already available and secure.

The application should not become tightly coupled to Oriya availability for essential farm operations. Daily recording and farm workflows should continue when Oriya or an external integration is unavailable. Queue or retry non-critical cross-platform events safely. Do not represent unsent data as synchronized.

## 5. What has already been changed on the rebrand branch

The following paths received the first public-facing branding pass:

1. `README.md` - new Flockence identity and the Oriya product relationship.
2. `package.json` - package metadata name changed from `chicken-op` to `flockence`.
3. `.env.example` - sender display name updated; legacy Oriya/AURA credential variable names are documented as compatibility names.
4. `Caddyfile.example` - example comment updated to Flockence; no live host changed.
5. `SECURITY.md` - product title/name updated.
6. `app/layout.tsx` - browser metadata title and description updated.
7. `components/nav.tsx` - visible navigation identity, search labels and monogram updated.
8. `components/auth-gate.tsx` - visible authentication-shell identity and monogram updated.
9. `components/auth-form.tsx` - visible authentication-form identity and monogram updated.
10. `app/operations/page.tsx` - visible product reference updated.
11. `app/vision/page.tsx` - visible product references and monogram updated.
12. `app/planning/page.tsx` - visible product reference updated.
13. `app/settings/page.tsx` - visible product references and monogram updated.
14. `lib/mail.ts` - password-reset email subject and body branding updated.
15. `public/manifest.webmanifest` - PWA name, short name and description updated.
16. `.github/workflows/ci.yml` - workflow display name, concurrency group prefix and diagnostic artifact name updated. Pull-request trigger was broadened so feature-to-feature PRs also run this workflow.
17. `docs/AURA_INTEGRATION.md` - integration guide updated to describe Flockence + Oriya while explicitly retaining legacy endpoint and credential compatibility.
18. `app/design-system/page.tsx` - design-system title updated.
19. `app/layers/packing/page.tsx` - visible product reference updated.
20. `app/performance/page.tsx` - visible product reference updated.
21. `components/account-actions.tsx` - sign-out label updated.
22. `components/daily-flock-check-form.tsx` - visible offline-mode explanation updated.
23. `components/food-safety-checklist.tsx` - visible product references updated.

This was a safe first pass, not a certified exhaustive repository-wide rename. A second agent must run a fresh full repository search on the current branch, including Markdown, HTML, CSS, JSON, environment examples, CI, deployment examples, tests, comments, metadata and generated assets.

## 6. Compatibility items deliberately not renamed

A blanket text replacement would be unsafe. The following identifiers are intentionally retained until a separately reviewed compatibility/migration change is designed:

### Database and environment identifiers

- PostgreSQL database name such as `chicken_op` in connection examples and CI configuration.
- `CHICKEN_OP_USER_ID`.
- Existing database/schema/table/model identifiers containing the old name, if present.
- Existing production environment variables and deployment secrets.

Do not rename these in a cosmetic rebrand. If a future migration is justified, support old and new environment names during a transition, document precedence, test startup/configuration, update deployment secrets and only retire old names after production migration is verified.

### Browser-side storage keys

Examples identified in the source include:

- `chicken-op-house-config`
- `chicken-op.daily-flock-check-queue`
- `chicken-op-food-safety...`
- `chicken-op-appearance-v2`

These may contain saved user preferences or pending offline records. Preserve them unless a compatibility reader/migration has been implemented and tested. A cosmetic brand update must not make local user data disappear.

### Existing Oriya/AURA integration contract

The current route prefix contains `/api/integrations/aura/*`. Existing environment variable names include:

- `AURA_INTEGRATION_TOKEN`
- `AURA_QUOTE_SECRET`

Keep these working until both Flockence and Oriya have a coordinated, tested versioned transition. Do not rename routes or rotate credentials without updating both sides and verifying live integration behavior.

### Repository and historical references

The repository slug `chicken-op`, historical branch names, historical migration/database references, old document filenames and commit history are not public-facing product labels. Do not rename the repository or rewrite Git history as part of this pass.

Historical documents can retain the old name where it is necessary to describe past state. New documentation should use Flockence.

### Animal/industry vocabulary

Do not replace legitimate references to chickens, birds, broilers, layers, eggs, poultry or other domain terms. The rename is a product identity change, not a terminology sanitization.

## 7. Existing Oriya integration - preserve, do not replace

The repository already contains an Oriya/AURA server-to-server integration. The route directory observed on the consolidated baseline is:

- `app/api/integrations/aura/catalog/route.ts`
- `app/api/integrations/aura/farm-summary/route.ts`
- `app/api/integrations/aura/orders/quote/route.ts`
- `app/api/integrations/aura/orders/confirm/route.ts`
- `app/api/integrations/aura/orders/status/route.ts`

The existing documented API contract is:

| Method | Existing route | Purpose |
|---|---|---|
| GET | `/api/integrations/aura/catalog` | Read current sale catalogue |
| GET | `/api/integrations/aura/farm-summary` | Read authorized farm summary |
| POST | `/api/integrations/aura/orders/quote` | Create a short-lived, signed quote |
| POST | `/api/integrations/aura/orders/confirm` | Confirm the exact quoted order |
| GET | `/api/integrations/aura/orders/status?phone=...` | Retrieve permitted order status |

Existing integration behavior documented in the repository:

- Server-side bearer credential: `AURA_INTEGRATION_TOKEN`.
- Separate quote signing secret: `AURA_QUOTE_SECRET`.
- Quotes are short-lived HMAC-signed payloads.
- Order confirmation uses an idempotency key and rechecks inventory inside a database transaction.
- The AI must not invent prices, inventory lot identifiers, customer phone numbers, delivery coordinates or trusted operational facts.
- Flockence remains the source of truth for live poultry operations, production, inventory, pricing and orders.
- Oriya asks Flockence for live answers; do not create a second source of truth by copying inventory into Oriya.

### Integration work required from the next agent

1. Read `docs/AURA_INTEGRATION.md`, every route above, and `lib/aura-integration.ts`.
2. Map the exact scopes and data exposed by each endpoint.
3. Verify authentication, authorization, tenant/farm binding, input validation, rate limits, audit events, idempotency and error handling.
4. Confirm the quote/confirm workflow with integration tests.
5. Verify failed Oriya connections do not impair local Flockence farm work.
6. Add correlation IDs and structured, redacted integration logs where missing.
7. Document credential rotation and least-privilege requirements.
8. Plan a future API namespace such as `/api/integrations/oriya/v1/*` only as a coordinated migration with compatibility routes. Do not implement a breaking rename as part of visual rebranding.
9. Reduce unnecessary customer personal information in integration responses. Review delivery addresses and other sensitive details for necessity and authorization.
10. Test the actual Oriya side before claiming end-to-end integration success.

## 8. Product scope and functional expectations

Flockence must support distinct broiler and layer production models. Do not force both production types through a broiler lifecycle.

### Shared farm foundation

- Farm, house, pen and facility configuration.
- Flock and batch creation, placement and lifecycle history.
- Staff, roles, task assignments and accountability.
- Supplier and procurement records.
- Feed, medicine, supplies and equipment inventory.
- Daily farm rounds and welfare observations.
- Health cases, observations, tests, treatments and withdrawal periods.
- Biosecurity and food-safety checks.
- Customers, products, quotations, orders, sales and payments.
- Expenses, cost allocation, accounting summaries and profitability.
- Reports, audit trails, data export and traceability.
- Offline capture and safe synchronization.
- Farm Vision image records and private media access.

### Broiler workflows

- Chick placement, source, date, quantity and cost.
- Flock census and mortality ledger.
- Daily feed, water and environmental observations.
- Growth and representative live-weight records.
- FCR only when required actual feed and weight coverage exists.
- Harvest readiness and planning without automatic slaughter commands.
- Feed withdrawal and treatment withdrawal verification.
- Transport, welfare checks and processor dispatch.
- Slaughter, condemnations, dressing yield and processing outputs.
- Meat, offal, parts, by-products and waste as distinct records.
- Cold-chain storage, product lots, sales and profitability.

### Layer workflows

- Chick/grower/pullet/pre-lay/laying lifecycle stages.
- Stage transitions with audit history and correct historical-date resolution.
- Daily egg collection with outcome and grade reconciliation.
- Hen-day and hen-housed production measures.
- Saleable rate, egg mass, feed per dozen and feed cost per dozen.
- Traceable egg packing, FIFO source lots, carton inventory, storage and labels.
- Withdrawal protection at collection, packing and sale.
- Layer flocks must not be routed into broiler slaughter/carcass processing.
- Layer feed forecasts should use layer-specific assumptions, not broiler slaughter targets.

### Food safety and animal health

Food-safety checklists should support practical good hygiene practices and HACCP-oriented control thinking, including worker hygiene, potable water, sanitation, cross-contamination, treatment withdrawal, cold chain, traceability, labelling, monitoring and corrective action.

Clearly distinguish practical guidance from a legal certificate, regulator approval or formal HACCP certification. Health/vision output should be observations and investigation prompts, not an unsupported disease diagnosis. Serious findings should be escalated to an appropriate qualified animal-health professional.

## 9. Security, reliability and release blockers

The following issues were already documented during the review of the consolidated branch. They are not caused by the rebrand and must not be hidden by it.

### Security follow-up

PR #5 documented these items:

1. **Password-reset URL trust:** the older feature branch had a conditional issue where a reset URL could fall back to the request-supplied `Origin` header if `APP_URL` was missing. PR #5 contains a fail-closed correction: require trusted `APP_URL`, reject URL credentials, and require HTTPS in production. Selectively port the correction to the current consolidated branch and add dedicated tests. Do not merge the old PR wholesale.
2. **CSRF/origin protection:** a shared same-origin/CSRF control for unsafe cookie-authenticated API methods was not found. Implement and test a common policy. Keep bearer-token integration requests and password-reset flows distinct.
3. **Private Vision storage:** validate `VISION_STORAGE_DIR` at startup and reject paths under the public web root. Preserve cross-farm media authorization and Nginx deny rules.
4. **Oriya integration permissions:** review broad read/write trust represented by one integration credential. Enforce least privilege, minimize customer PII and use the separate quote-signing secret.
5. **Trusted proxy assumptions:** ensure the reverse proxy overwrites/strips untrusted forwarded IP headers and the origin server cannot be accessed in a way that bypasses Cloudflare/proxy controls.
6. **Dependency integrity:** add a reproducible lockfile, move CI to `npm ci`, audit dependencies and pin GitHub Actions to reviewed immutable commit SHAs where practical.

This source review is not a penetration test or production security certification.

### Existing CI limitation

The previous PR #4 workflow attempt failed before any workflow steps were reported. The Flockence PR #7 did trigger the renamed workflow, but the latest observed run `41244729609` (2026-10-31), plus runs `41244689511`, `41244635740` and `41244616717`, all ended as failures with `steps: null` and no job log URL. No Prisma validation, automated tests, TypeScript check or production build steps are evidenced as having executed. Treat this as a CI runner/workflow-startup blocker, not an application test failure or a passing validation result. Investigate hosted-runner allocation and GitHub Actions diagnostics, then rerun and retain the actual step logs.

The CI workflow was updated on the Flockence branch so pull requests targeting feature branches can trigger CI. A PR workflow run has now been observed, but it failed before the job steps and therefore provides no application validation.

### Production/release limitations

- No committed Prisma migration history was present in the consolidated branch tree.
- The live production database has not been introspected in this handoff session.
- The production migration baseline must be established and tested against a restored production copy using `docs/PRODUCTION_DATABASE_MIGRATION_BASELINE.md`.
- Do not use `prisma db push` as a substitute for a reviewed production migration.
- No npm lockfile was committed on the reviewed baseline.
- No confirmed production deployment workflow/stack was available in the repository; an example reverse-proxy configuration is not a deployment plan.
- Database and private-media backup/restore drills remain release gates.
- Mobile/tablet/desktop operator walkthrough and authentication/role acceptance tests remain release gates.

### Multi-farm / tenant scope

The current documented configuration is **one configured farm per deployment**. Do not market or describe the present implementation as fully multi-tenant SaaS.

A true multi-farm SaaS conversion requires deliberate tenant-context architecture and data-access auditing across every model, API, background job, file/media access path, integration, report and export. Do not perform a broad tenant migration as part of the product rename.

## 10. Oriya business voice-agent requirements

This is a shared Oriya core capability discussed for the wider Oriya platform. It is not evidence of a completed voice integration in Flockence. Keep it platform-level and configurable by each business vertical.

### Core principle

The voice agent must be **objective-driven, not script-driven**. It must understand the real business it represents, why each inbound or outbound call is taking place, what the caller needs, what the business is authorized to do and what a valuable call outcome looks like.

Every call needs:
- A primary objective.
- A secondary objective where appropriate.
- A minimum acceptable outcome.
- Prohibited outcomes/actions.
- An exit, transfer or follow-up condition.

Value is not limited to revenue. It includes issue resolution, customer retention, accurate information, qualified opportunities, operational task completion, risk discovery and stronger customer relationships.

### Configurable intelligence layers

1. **Business intelligence:** verified company profile, products/services, policies, pricing, service boundaries, operating procedures, customer segments and approved knowledge.
2. **Call objective engine:** purpose, caller intent, success conditions, next required action and stop conditions.
3. **Conversational intelligence:** listening, natural turn-taking, tone/emotion cues, interruptions, humor, anger, confusion, hesitation and objections.
4. **Decision/action engine:** live verification, scoped tools, permissions, action confirmation and escalation rules.
5. **Business value engine:** structured post-call records, follow-up tracking, customer insights and manager reporting.

### Inbound and outbound call behavior

- Before outbound calls, retrieve relevant customer context, previous interactions, open issues, commitments and a legitimate contact purpose.
- Introduce the business and reason for calling accurately. Respect time, consent, opt-out and contact restrictions.
- For inbound calls, answer the immediate question while identifying the actual need behind it.
- Be equally capable of a short enquiry and a complex business conversation.
- Never pretend to be a human employee.
- Never fabricate the reason for a call, business facts, availability, prices or completed actions.

### Caller adaptability

Adapt appropriately to:
- Angry/frustrated callers: listen, acknowledge, clarify, de-escalate, offer authorized next steps.
- Humorous/playful callers: engage naturally without losing professional direction.
- Talkative callers: preserve rapport and gently guide the conversation.
- Quiet or hesitant callers: ask one clear question at a time and allow time to respond.
- Confused callers: simplify and confirm understanding.
- Impatient callers: prioritize the answer and avoid unnecessary explanation.
- Highly knowledgeable callers: communicate at the right level.
- Vulnerable/distressed callers: prioritize clarity, respect and human help where needed.
- Abusive or threatening callers: maintain boundaries and use escalation/termination policy.

Treat emotion/tone as contextual signals, not clinical or psychological diagnoses. Do not imitate accents, mock people, become confrontational or use manipulative pressure tactics.

### Autonomy and tool safety

The agent may answer from verified knowledge, collect approved information, qualify enquiries, recommend approved options and initiate authorized actions.

It must not invent or independently authorize prices, discounts, refunds, contract terms, compensation, availability, delivery commitments, protected-data disclosure or actions outside its granted permissions.

A requested action is not a completed action. Verify system success before telling a caller that an order, booking, payment, transfer or follow-up has completed.

### Human handover

Escalate when the caller asks for a person, the issue exceeds authority, safety/legal/contractual sensitivity arises, data conflicts, an action fails, or the agent lacks sufficient confidence.

Handover should include verified identity context, reason, discussion summary, objective, caller concern, attempted actions, pending issue and the specific human decision required. Avoid making callers repeat themselves.

### Post-call value

Create structured call records with direction, date/time, verified contact, purpose, objective, outcome, requirements, concerns, commitments, actions, follow-up owner/date, escalation, opportunity and operational insight.

Separate actual outcomes from prospects and unverified possibilities. Identify repeated questions, product demand, unresolved complaints, reasons for lost sales, customer-retention risks and operational failures.

Measure goal completion, first-contact resolution, customer experience, qualified opportunity, actual conversion, follow-up completion, factual accuracy, policy compliance and appropriate escalation. Do not optimize call duration or sales conversion at the expense of trust or resolution.

### Implementation rule

Keep the core voice constitution, business profile, objective definition, customer context, permissions and industry procedures as separate runtime layers. Enforce critical restrictions through application authorization and tool scopes, not prompt text alone. Flockence-specific knowledge must remain isolated from other Oriya business verticals.

## 11. Immediate task list for the second agent

Work in this order. Do not skip the investigation stage.

### Phase A - verify current branch and baseline

1. Checkout `rebrand/flockence-2026-10-31` and confirm current HEAD before editing.
2. Review all commits on the branch and confirm the base is still the intended consolidated broiler/layer branch.
3. Read PR #4 description and current PR/CI status.
4. Read PR #5 and its source review; selectively port required security corrections only after diffing against current code.
5. Do not overwrite changes already committed by the first rebrand pass.

### Phase B - complete the rebrand safely

1. Run a case-insensitive, repository-wide search for:
   - `Chicken Op`
   - `ChickenOp`
   - `chicken-op`
   - `CHICKEN_OP`
2. Classify every hit as:
   - user-facing label/metadata to update,
   - technical compatibility identifier to preserve,
   - historical/audit reference to preserve,
   - animal/industry word that is not a brand reference.
3. Replace remaining user-visible legacy branding in all pages, dialogs, toasts, emails, reports, PWA/SEO metadata and help text.
4. Check favicon, PWA icon, browser title, login/signup/forgot/reset pages, navigation, desktop/mobile surfaces, exported reports and email sender/subject/body.
5. Implement the actual Flockence logo/wordmark and product visual tokens using the current theme/accessibility system.
6. Ensure the wordmark and brand mark have accessible names/alt text; check small-size legibility and theme contrast.
7. Keep localStorage keys compatible; if changing any, write a migration/read-through path and add tests.
8. Review deployment examples and filename references without renaming live identifiers unnecessarily.

### Phase C - preserve and test Oriya integration

1. Preserve existing routes and authentication while both products are updated.
2. Add/refresh contract tests for catalogue, farm summary, quote, confirm and status endpoints.
3. Verify HMAC quote integrity/expiry and replay resistance.
4. Verify idempotency and in-transaction inventory recheck.
5. Review least privilege, data minimization, audit logging, rate limits and redaction.
6. Verify farm/business identity binding and no cross-farm data access.
7. Confirm graceful behavior when Oriya is unavailable.
8. Document a future versioned Oriya route migration without implementing a breaking cutover.

### Phase D - quality and release gates

On Node 22 and an isolated disposable PostgreSQL database, run and record:

- dependency install using the package's actual manager; once a reviewed lockfile exists use `npm ci`.
- `npm test`
- `npx prisma validate`
- `npx prisma generate`
- `npm run typecheck`
- `npm run build`
- integration contract tests
- authentication/role/CSRF tests
- private Vision storage and cross-farm isolation tests
- offline queue persistence and sync/retry tests
- broiler and layer workflow regression tests
- PWA install/update smoke tests

Do not report checks as passed unless their actual logs/results are available. A GitHub runner-startup failure is an infrastructure blocker, not a successful or failed application test.

### Phase E - delivery

Produce:
- Full search inventory and classification of remaining legacy-name hits.
- Files changed and rationale.
- Any local-storage or configuration compatibility migration.
- Oriya API contract test report.
- Security findings resolved/not resolved.
- Actual CI logs and test results.
- Desktop/tablet/mobile screenshots or walkthrough evidence.
- Release/rollback plan.
- List of remaining DNS, deployment and legal/domain-name-clearance tasks.

Keep the rebrand pull request in draft until the tests and release gates are genuinely satisfied. Do not merge or deploy without approval.

## 12. Guardrails

- Do not delete or rewrite production data.
- Do not run migrations against production from this task.
- Do not rename database objects or environment variables as a search-and-replace operation.
- Do not rotate Oriya credentials without coordinated configuration on both sides.
- Do not make DNS, TLS, reverse-proxy or `APP_URL` production changes without a tested migration plan.
- Do not merge PR #4 or PR #5 as part of the rebrand.
- Do not claim multi-tenant readiness.
- Do not claim disease diagnosis, official food-safety certification or legal compliance.
- Do not invent test results or claim production deployment.
- Preserve audit history and Git history.

---

## 13. First-pass status summary

| Area | Status |
|---|---|
| Product name selected | Flockence |
| Product/parent relationship | Flockence, powered by Oriya |
| Initial public-facing brand pass | Committed on rebrand branch |
| Package metadata | Updated |
| PWA name | Updated |
| Email brand strings | Updated |
| Existing Oriya integration | Preserved, not replaced |
| Legacy API/env names | Intentionally retained |
| Database identifiers | Intentionally retained |
| Browser storage keys | Intentionally retained |
| Domain/DNS/TLS | Not verified or changed |
| Logo and complete design system | Still to build |
| Repo-wide remaining-string audit | Still required |
| Local tests/build from this session | Not run |
| CI result for rebrand branch | Four observed runs failed before steps; latest 41244729609 has no logs |
| Production migration/deployment | Not performed |
| Merge status | Draft PR #7, unmerged; GitHub reports mergeable, but CI state is unstable |

**The next agent's immediate instruction:** continue from `rebrand/flockence-2026-10-31`, inspect the current HEAD, complete the repository-wide brand audit, build the real Flockence design identity, preserve the existing Oriya integration contract, and close the documented security and release gates without breaking farm workflows or existing records.


## 14. Optional Blink camera connector added after the first rebrand pass

A separate Python connector foundation was added on the Flockence rebrand branch under `integrations/blink/`.

### Files added

- `integrations/blink/adapter.py` - curl_cffi AsyncSession response/session adapter compatible with BlinkPy's get/post interface.
- `integrations/blink/example.py` - manual connection smoke test for an account the operator owns or administers.
- `integrations/blink/requirements.txt` - pinned optional Python dependencies: BlinkPy 0.25.9 and curl-cffi 0.17.0.
- `integrations/blink/.env.example` - environment variable template for Blink username, password and impersonation profile.
- `integrations/blink/README.md` - setup, compatibility notes, security boundary and test instructions.
- `integrations/blink/tests/test_adapter.py` - fake-session contract tests for response mapping, GET/POST delegation, context management and idempotent close.
- `.github/workflows/blink-adapter.yml` - separate Python 3.12 CI workflow triggered for Blink integration changes.
- Root README and .gitignore were updated to reference the optional connector and ignore Python local artifacts.

### Compatibility fixes versus the supplied snippet

- Current BlinkPy Auth accepts `login_data`, not the proposed `session_data` keyword.
- Current BlinkPy lifecycle methods are asynchronous. Use `await blink.start()` and `await blink.refresh(force=True)`.
- The example handles the explicit two-factor-required exception and calls BlinkPy's `complete_2fa_login` after an operator enters the verification code interactively.
- The adapter exposes `status`, `headers`, `url`, `reason`, and async `json()`, `text()` and `read()` methods.
- The underlying curl_cffi session is closed from a `finally` block.

### Important scope boundary

This is an isolated optional connector and manual smoke test. It is **not** a live camera integration in the Next.js app yet. It does not add a Flockence camera settings screen, API routes, background worker, live stream, motion-event pipeline, snapshot/clip transfer or Farm Vision ingestion. No Blink credentials were supplied or used, and no real Blink account login was tested.

Do not store Blink account passwords or provider tokens in browser code, ordinary farm settings, logs or Git. The example reads secrets from environment variables and prompts for an MFA code without persisting it. For production, move credentials into a dedicated secret manager and run the connector in a separate, least-privilege service.

The browser fingerprint profile is a transport compatibility option, not a guarantee of access. It does not authenticate an account, satisfy MFA, grant authorization or override provider restrictions. Respect the provider's terms and security challenges. BlinkPy's maintainer explicitly cautions against API calls more frequent than once per 60 seconds; do not introduce aggressive polling.

### CI observation after adding the connector

The separate Blink adapter workflow and the main Flockence workflow were both triggered for this PR update. The Blink adapter and main Flockence workflows have repeatedly failed before any job steps were reported (`steps: null`, no log URL). These are runner-startup failures, not test failures, and do not prove that the connector passes. The Python tests and module compilation have not yet been evidenced as executed. Check the current PR checks for the newest run IDs and results before continuing.

### Next steps before calling this feature integrated

1. Get the Python adapter CI to execute and inspect actual logs.
2. Add an encrypted credential onboarding flow if Blink is to be configured from the Flockence UI. Do not persist raw credentials in the existing settings model.
3. Create a separate authenticated connector service with farm-scoped read-only camera metadata/events first.
4. Add connection health, last-sync time, refresh backoff and an operator-controlled disconnect/revoke action.
5. Only after the metadata path is secure, evaluate snapshots/clips. Route any imported media through the existing private Vision media store, validation and authenticated read endpoint.
6. Add tests for farm isolation, credential redaction, retry limits, provider throttling, disconnect and failure handling.
7. Do not add remote camera-control actions (arming, disarming, siren, PTZ) until a separate explicit authorization and safety review is completed.
8. Do not describe the Blink connector as a production integration until the service bridge, credential-management flow, authenticated UI/API, real-account acceptance test and privacy review are complete.


## 15. Blink sidecar transport and login screen update

A follow-up correction addresses the fact that the earlier `integrations/blink` adapter was not being used by the FastAPI sidecar that powers the Cameras page.

- `services/blink/transport.py` is now the shared session adapter around `curl_cffi.requests.AsyncSession`.
- The sidecar uses that adapter for saved-session restoration, new account login, MFA, token refresh and camera requests.
- The default profile is `safari18_0_ios`, configurable through `BLINK_IMPERSONATE`.
- Sidecar and connector requirements pin `blinkpy==0.25.9` and `curl-cffi==0.17.0`.
- Flockence's Cameras page now shows the **Connect Blink** card while disconnected. It accepts the Blink email/password, then shows the MFA code field when Blink requests verification.
- The sidecar uses BlinkPy's `Blink.send_2fa_code()` helper for MFA completion, preserving its required post-verification URL and homescreen setup.
- Automated fake-session tests cover the 202/MFA route, 201 verification response, redirect authorization code, token exchange, and a silent empty-body 401 that must fail once without automatic retries.
- The Blink workflow now runs the adapter/OAuth tests and compiles both the sidecar and integration package.

### How the operator signs in

1. Sign in to Flockence with the farm owner account.
2. Open **Cameras**.
3. Enter the Blink account email and password in **Connect Blink**, then click **Connect**.
4. Enter the one-time verification code when prompted and click **Verify**.
5. After the connection is accepted, camera discovery populates the Live, Pictures and Recordings views.

### Remaining release requirements

The test suite uses fake HTTP responses and does not establish that Blink is accepting a real account. Before relying on this for home security, install the pinned sidecar dependencies, restart the Python sidecar with the corrected code, complete the actual account login/MFA in the Cameras page, and confirm both camera metadata and an image are returned. Keep the sidecar loopback-only and do not store the account password or MFA code. Do not merge or deploy solely because the GitHub workflow was triggered; confirm that its test steps actually run.
