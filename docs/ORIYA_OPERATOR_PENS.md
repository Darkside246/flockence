# Flockence pen reports in Oriya

Use an authenticated WhatsApp Operator Mode session for the linked Oriya
business on the premium Flockence plan. In Farm Vision, a farm owner or
manager can select an existing pen before saving a camera or uploaded
inspection. Camera inspections use the saved farm camera assignment when available. Past unassigned inspections stay unassigned.

| Command | Result |
| --- | --- |
| `/pens` | List active pens and their references |
| `/pen report Pen 1` | Latest recorded assessment, its date, visible findings and checks |
| `/pen updates Pen 1` | Up to three inspections recorded for that pen |
| `/pen remind Pen 1 \| tomorrow at 8am` | Schedule a WhatsApp reminder in the business’s timezone |

Use a pen reference when more than one has the same name. These commands
fetch only the active business's linked farm at the time of the request.
The report labels the latest active batch health-check data as farm context.
It does not attribute those measurements to the selected pen. Missing
readings and inspections stay missing. Replies carry no camera addresses,
images, credentials or customer data. Oriya formats the recorded values
without sending the report to another AI provider. Reminders store a generic
request to check the pen. They use the existing Operator Mode reminder
delivery service and do not embed historical inspection findings.

For staging, deploy the matching Flockence and Oriya changes and rehearse
the existing assessment SQL from PR #13 against a restored database.
Configure the existing Oriya connection for the correct HTTPS Flockence
host and use a premium staging business with a ready farm link and an
authorized WhatsApp Operator Mode session. Verify a real reminder and a
downgraded business before production rollout.
