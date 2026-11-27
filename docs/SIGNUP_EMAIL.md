# Signup email and sender setup

1. Add a sending domain in [Resend](https://resend.com/docs/dashboard/domains/introduction). For Flockence, use `flockence.com` or a dedicated sending subdomain. Publish the DNS records Resend shows in the authoritative DNS manager, and confirm the Sending status is Verified.
2. Create a domain-restricted [Sending access API key](https://resend.com/changelog/new-api-key-permissions). Store it on the VPS as `RESEND_API_KEY` in the active service environment. Never commit it to GitHub.
3. Set `RESEND_FROM="Flockence <no-reply@flockence.com>"` if the root domain is verified. Use the matching subdomain in the From address if that is what was verified. Verification, welcome and password-reset email use this same sender.
4. Configure `APP_URL="https://flockence.com"` and `AUTH_COOKIE_SECURE="true"`. Disable click tracking for verification mail so the direct verification link is preserved. Test delivery to an inbox you can inspect and confirm acceptance in Resend logs.
5. Create [reCAPTCHA v2 checkbox keys](https://developers.google.com/recaptcha/docs/display) for the signup hostname. Set `RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY` in the active VPS environment. The site key is public and the secret stays server-side. Configure the trusted reverse proxy to overwrite `X-Real-IP` with the client address. Flockence validates the challenge with Google before sending any verification email, and public issuance fails closed if validation is unavailable.
6. Keep `PUBLIC_FREE_SIGNUP="off"` during rollout. Turn it on only after testing the verified sender and the release end to end in a controlled environment. Changing the VPS environment requires restarting the app service.

Edit the subject and message bodies in `lib/mail.ts`. Set `FLOCKENCE_WELCOME_EMAIL="on"` to send welcome mail after password signup. The invitation and verified-Free welcome paths use `sendWelcomeEmail`. Verification uses `sendFreeSignupVerificationEmail`. The verification link is single-use, expires after 30 minutes, and belongs to its recipient. Keep that link in the email when editing its wording.

No schema migration is needed. Account creation, proof consumption, and the new farm session are transactional. Free signup and invitation signup use separate routes.

## Account form protection

The same two reCAPTCHA keys enable the server-verified challenge on password sign-in, invitation or owner setup, password-reset requests, and public Free signup. Set `FLOCKENCE_AUTH_CAPTCHA="on"` on the hosted instance to require the keys even if the environment is accidentally incomplete. Verify the production hostname and keys in staging before enabling that setting. It applies to all local account roles and plans.

The email link itself proves inbox control for Free signup. Reset completion uses a single-use recovery token, same-origin JSON requests, rate limits and no-referrer headers. The reset page does not load a third-party CAPTCHA script. Oriya sign-in continues through its existing provider. Farm operations, device endpoints, and offline sync keep their existing access controls. Invitation creation and role changes require authorized users, same-origin JSON and farm-scoped limits.

## Switch to reCAPTCHA v3

Use a [reCAPTCHA v3 key pair](https://developers.google.com/recaptcha/docs/v3)
registered to the exact public hostname. On a release that includes v3,
set `RECAPTCHA_MODE="v3"` and replace both `RECAPTCHA_SITE_KEY` and
`RECAPTCHA_SECRET_KEY` together. Preserve the working v2 pair privately
until the rollout passes. The application generates a fresh token for
each submit and checks the hostname, action and a minimum score of 0.5
on the server. The v3 mode displays no checkbox. Password sign-in,
invited and owner signup, reset requests, and Free signup each have a
separate action.

Test login in a second browser session and verify the reset email before
opening public signup. If legitimate submissions are rejected, check the
Google console and restore the matched v2 pair with `RECAPTCHA_MODE="v2"`
while reviewing the scores. A change to the service environment requires
a restart. The signed-in account and offline workflows do not load reCAPTCHA.

## Email a farm invitation

Open Team, enter the recipient's email, choose a role and send the invitation.
The link opens a name and password form. Flockence assigns the email, farm
and role from the invitation. Opening the email link only previews the farm
and role. Submitting the form consumes the link.

Use the same verified Resend sender and disable click tracking for this
transactional email. Team managers can see and revoke pending invitations
within their permitted roles. A recipient with an existing Flockence account
needs the existing account support path. Each account currently belongs to
one farm. Existing manual codes remain available through the original API
and signup page.
