# Signup email and sender setup

1. Add a sending domain in [Resend](https://resend.com/docs/dashboard/domains/introduction). For Flockence, use `flockence.com` or a dedicated sending subdomain. Publish the DNS records Resend shows in the authoritative DNS manager, and confirm the Sending status is Verified.
2. Create a domain-restricted [Sending access API key](https://resend.com/changelog/new-api-key-permissions). Store it on the VPS as `RESEND_API_KEY` in the active service environment. Never commit it to GitHub.
3. Set `RESEND_FROM="Flockence <no-reply@flockence.com>"` if the root domain is verified. Use the matching subdomain in the From address if that is what was verified. Verification, welcome and password-reset email use this same sender.
4. Configure `APP_URL="https://flockence.com"` and `AUTH_COOKIE_SECURE="true"`. Disable click tracking for verification mail so the direct verification link is preserved. Test delivery to an inbox you can inspect and confirm acceptance in Resend logs.
5. Keep `PUBLIC_FREE_SIGNUP="off"` during rollout. Turn it on only after testing the verified sender and the release end to end in a controlled environment. Changing the VPS environment requires restarting the app service.

Edit the subject and message bodies in `lib/mail.ts`. The invitation and verified-Free welcome paths use `sendSignupWelcomeEmail`. Verification uses `sendFreeSignupVerificationEmail`. The verification link is single-use, expires after 30 minutes, and belongs to its recipient. Keep that link in the email when editing its wording.

No schema migration is needed. Account creation, proof consumption, and the new farm session are transactional. Free signup and invitation signup use separate routes.
