# Flockence startup, camera sign-in and email

On a VPS with a running Flockence release and a local PostgreSQL cluster,
run the new startup helper from a verified GitHub checkout under /opt.

```bash
sudo bash /opt/<prepared-release>/app/ops/systemd/enable-local-stack.sh
```

The helper reads the active Flockence service path, identifies the local
database cluster, starts it and makes it a systemd dependency of Flockence.
If a Blink unit is missing, the existing private worker installer creates
and shares its internal token automatically. It uses the camera code from
the prepared checkout and the configuration from the active app. An
existing managed setup keeps its credentials and recordings. A conflicting
custom setup needs review. The helper performs no database schema changes
or application release switch.

After setup, the enabled Flockence unit starts the local stack on boot.
Systemd starts PostgreSQL and the private camera worker before launching
the app. Each app launch also checks that PostgreSQL is accepting
connections. Flockence and the camera worker restart after an unexpected
exit. PostgreSQL restarts after a failed process. Retries are spaced
10 seconds apart for the app and camera and 15 seconds apart for the
database. A camera outage leaves the main app available, and an
administrator can still intentionally stop a unit. Existing setup can be
upgraded by running the helper again. Oriya and the public HTTPS proxy
retain their own service management.

## Where to enter an email

- **Blink account**. In Flockence, sign in as the farm owner and open Cameras.
  Select Blink, enter the Blink email and password, and enter the code if
  Blink requests verification. The form appears when the private service is
  ready. Booting the service and signing in to the camera account are
  separate steps.
- **Flockence sign-in**. The Account page shows the current password-based
  sign-in email. For accounts created with Oriya sign-in, update email and
  password in Oriya.
- **Outgoing mail**. Use a verified sending domain in Resend. The VPS
  administrator saves `RESEND_API_KEY` and `RESEND_FROM` in the private
  active Flockence service environment. For example, the sender can be
  `Flockence <no-reply@flockence.com>` after domain verification. Set
  `FLOCKENCE_WELCOME_EMAIL=on` to send the welcome template from
  `lib/mail.ts` for new password-based accounts. Restart Flockence to load
  environment changes. An administrator can verify configuration status at
  /platform without viewing any mail credentials. [Resend domain setup](https://resend.com/docs/dashboard/domains/introduction)
