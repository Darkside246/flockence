# Flock health cases: how they open, stay open, resolve and close

## The problem this fixes

Before this change a health case could be created and never changed. The case had a status (`OPEN`, `MONITORING`,
`RESOLVED`, `CLOSED`) but nothing could move it, so every case stayed open for ever. A lab test could not be given a
result, so it stayed "pending" for ever. A treatment could not be ended. And the withdrawal period counted from the day a
treatment *started*, which understates it for a multi-day course.

## Life of a case

| Status | Meaning | Rules |
| --- | --- | --- |
| **Open** | Something is wrong and is being worked on | Updates, counts and severity can be corrected. Goes quiet for 3 days: flagged "No update for N days". |
| **Monitoring** | Treated or settled, and being watched | Must carry the date of the next review (not in the past). Past that date: "Review overdue". "Got worse" sends it back to Open. |
| **Resolved** | The flock recovered or the situation ended | An outcome is required. Isolation and movement restrictions must be lifted on purpose (a tick box), not by accident. |
| **Closed** | Nothing left to do or wait for; the record is frozen | Needs Resolved first. Blocked while a lab result is pending. Blocked for a suspected notifiable disease until the report to Veterinary Services is recorded. |

A resolved or closed case can be **reopened with a reason**; the case counts how many times it has come back.
Cases are never deleted. Every step leaves a dated line in the case history (opened, update, status change, report, test
result, treatment ended).

Who can do what: anyone who records on the farm (owner, manager, worker) can open a case and add updates, start
monitoring, say it got worse, record a report, record a test result. **Resolve, close and reopen are the owner's or
manager's call.** Ending a treatment is also owner/manager (the same people who can record one). Read-only users see cases
and nothing else.

Resolving or closing never releases food: withdrawal belongs to each treatment and keeps running; the screen says so.

## Withdrawal now runs from the end of treatment

`lib/treatment-timing.ts`: clearance = end of treatment + withdrawal days. A 5-day course with a 7-day withdrawal clears 12
days after it began (it used to say 7). The end is the recorded end date, or the start plus the course length, or the start
for a single dose. Ending a treatment ("finished" or "stopped early") recomputes clearance from that day. Treatments saved
before this change keep the date they were saved with.

## Notifiable diseases

A case can be flagged as a suspected notifiable disease (sudden high deaths, twisted necks, swollen heads: Newcastle
disease and avian influenza are the usual concern). It shows "not yet reported" until a report to Veterinary Services is
recorded (date and their reference), and it cannot be closed before that. Flockence does not send the report; it makes sure
nobody forgets. Check the reporting rule with the Barbados Veterinary Services Department: I could not find the statute
online, only the Chief Veterinary Officer asking farmers to report signs of sudden illness.

## How this compares

Findings are from vendor web pages and trade/government guidance, which are marketing and guidance, not audits. I could
not open Agriness's help pages (404) or find independent reviews. Treat "they have it" as "they say they have it".

| Capability | Typical packaged software (what vendors describe) | Flockence before | Flockence now |
| --- | --- | --- | --- |
| Record illness and treatment per flock | Yes: Farmbrite, FarmKeep, Odoo poultry module, Poultry Keeper | Yes | Yes |
| Case with a lifecycle (open to closed) and outcome | Mostly a simple log or status filter (Poultry Keeper: healthy / observation / sick / quarantine) | Status existed, nothing could change it | Open / Monitoring / Resolved / Closed, outcome, reopen |
| Follow-up date on a watched problem | Reminders and a calendar (Poultry Keeper, Farmbrite tasks) | None | Required review date; overdue flag |
| Withdrawal compliance | Spoors, Meon and others track it; Farmbrite's page does not mention it | Tracked, from the start date | Tracked, from the end of treatment; shown when a case ends |
| Lab result tracking | Odoo module lists vaccine and disease history | Tests could be created, never given a result | Result recorded, diagnosis carried to the case, blocks closing while pending |
| Escalation to a vet or supervisor | Spoors: automatic notification and SLA escalation | Urgent banner only | Flags (overdue review, silent case, unreported notifiable disease). No messaging yet |
| Mortality capture and analysis | Agriness, Spoors, PoultryCare (for example a 0.2% mortality alert) | Mortality records exist | Case deaths shown; no automatic case from a mortality spike yet |
| Vaccination schedule and missed-window alerts | Spoors, Meon, Odoo, Poultry Keeper | Not present | Not present: see below |
| Audit trail | Mentioned by Farmbrite ("audit-ready") | Partial | Every change to a case is dated and kept |

## Standards and practice used

- Treatment records should hold the product, date, dose, which birds, the withdrawal length and batch details, and be
  kept for years (Red Tractor: 5 years; EU veterinary medicines directive: at least 5 years; Cornell: at least 2). The
  record retention period for Barbados should be confirmed with the Ministry.
- Mortality should be recorded by category and often through the day, and unusual deaths treated as a possible
  infectious problem (University of Kentucky poultry extension); Cobb's post-mortem guide asks for the flock's history
  to be gathered when investigating.
- A suspect disease means restriction first, release only on verified results: the Canadian (CFIA) and UK material keep
  a quarantine until the authority lifts it, and do not treat a farm as clear on its own say-so.

## Not built yet (suggested next)

1. **Vaccination programmes**: a schedule per flock (day-of-age or date), due and missed-window alerts, vaccine stock.
2. **Automatic case from mortality**: open a case when daily deaths pass a threshold (a common alert is 0.2% a day).
3. **Alerts out of the app**: tell the owner or the vet by message when a notifiable case is unreported, a review is
   overdue, or a case turns Urgent (Oriya's alert channel is the natural place).
4. **Case tasks and reminders**: a review date that creates a task on the Daily Round.
5. **Photos on a case**: link Farm Vision photos to a case's history.
6. **Per-bird or per-pen tracking** for layers (Poultry Keeper does this for small flocks); not needed for broilers.
7. **Retention and export**: a printable case record for the vet or an inspector.

## Sources

- [Farmbrite chicken management software](https://farmbrite.com/chicken-management-software)
- [Spoors poultry operation management](https://www.spoors.in/poultry-operation-management)
- [Poultry Keeper: Flock Log (listing summary)](https://mwm.ai/apps/poultry-keeper-flock-log/6785443091)
- [Odoo poultry management module](https://apps.odoo.com/apps/modules/18.0/dev_advance_poultry_management)
- [PoultryCare broiler module](https://www.poultry.care/modules/broiler)
- [Cobb post-mortem guide (breeders)](https://www.cobbgenetics.com/assets/Cobb-Files/Post-Mortem-Guide-_Breeders-2025-English_7-2025_rs.pdf)
- [University of Kentucky: production records](https://afs.mgcafe.uky.edu/poultry/chapter-16-production-records)
- [Red Tractor animal medicines standards](https://redtractor.org.uk/assurance/standards/animal-medicines-19/)
- [Cornell: animal health treatment records](https://smallfarms.cornell.edu/guide/guide-to-direct-marketing-livestock-and-poultry/animal-health-treatment-records/)
- [EU veterinary medicines directive, article 11 (withdrawal periods)](https://www.legislation.gov.uk/eudr/2001/82/article/11/data.htm?view=plain)
- [CFIA: the path to resuming operations after HPAI](https://inspection.canada.ca/en/animal-health/terrestrial-animals/diseases/reportable/avian-influenza/path-resuming-operations-after-hpai)
- [Queensland: managing emergency disease outbreaks in poultry farms](https://www.business.qld.gov.au/industries/farms-fishing-forestry/agriculture/livestock/poultry/biosecurity-for-poultry-producers/sick-birds-emergency-situations)

## Database change

Additive: `ops/postgres/add-health-case-lifecycle.sql` adds the lifecycle columns to `HealthCase` and the new `HealthCaseEvent` table. Apply it on the VPS with a verified backup, then re-run the farm row-security script so `HealthCaseEvent` gets the farm boundary (it is listed in `ops/postgres/farm-rls.sql`).
