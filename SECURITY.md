# Flockence security requirements

## Authentication

- Passwords are stored as salted `scrypt` password hashes. Plaintext passwords are never stored.
- Passwords must be at least 8 characters and contain at least one uppercase letter and one special character.
- Session tokens are generated with cryptographically secure randomness and only their SHA-256 hashes are stored in the database.
- Password-reset tokens are generated with cryptographically secure randomness and only their SHA-256 hashes are stored.
- Session cookies are HttpOnly, SameSite=Lax, and Secure in production.
- Password-reset responses do not reveal whether an email address exists.

## Data in transit

Production must terminate HTTPS at the reverse proxy. The included Caddy configuration provides automatic HTTPS and HTTP-to-HTTPS redirection. The application also sends HSTS and other security headers.

When PostgreSQL is hosted on a different machine or service, use a PostgreSQL connection string with `sslmode=require` or stronger certificate verification as supported by the provider. When PostgreSQL is on the same private Droplet, keep the database bound to the private/local interface and do not expose its port publicly.

## Data at rest

Application-level password and token secrets are protected by hashing. Operational records are not individually encrypted column-by-column because that would prevent normal relational queries and reporting.

For the requested full at-rest protection, the production Droplet/database storage and backups must use encrypted storage. DigitalOcean states that volume snapshots are encrypted at rest by default. The production deployment should keep PostgreSQL data on encrypted storage and ensure backups/snapshots inherit the provider's at-rest encryption controls.

Do not commit `.env`, database passwords, API keys, reset links, session values, or other secrets to Git.
