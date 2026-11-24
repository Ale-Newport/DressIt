# Security policy

DressIt stores people's wardrobes, photos, location (rounded to ~1 km) and
calendars, so security and privacy reports are the most valuable contribution
there is.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/Ale-Newport/DressIt/security/advisories/new)
(Security tab → *Report a vulnerability*). Only the maintainer can see it.

Helpful things to include: what an attacker can do and from where, the steps or
a failing test, and the version or commit. You will get an acknowledgement
within a few days and a fix or a plan before anything is disclosed.

## Supported versions

| Version | Supported |
|---|---|
| `main` / latest release | ✅ |
| Older releases | ❌ |

## Scope

In scope: the API (`services/api`), the vision service (`services/vision`), the
mobile app (`apps/mobile`) and the database schema and policies.

Especially interesting: one user reading or changing another user's data, SSRF
through product-link import, signed image URLs that can be forged or reused
across users, authentication or refresh-token weaknesses, and personal data
leaking into logs or third-party requests.

Out of scope: denial of service by volume, findings that need a compromised
device or server, and third-party retailer sites.

## How the project protects itself

- PostgreSQL row-level security forced on every personal table; the API runs as
  a non-owner role and each request sets the user context (tested at HTTP and SQL level).
- argon2id passwords, 15-minute JWTs and rotating refresh tokens with reuse detection.
- SSRF-safe fetching: public unicast addresses only, checked at connect time,
  every redirect re-validated, size/time/content-type limits, `robots.txt`.
- Private images only through short-lived HMAC-signed URLs; EXIF/GPS stripped on upload.
- Secret scanning (gitleaks), CodeQL and dependency updates in CI.

Details: [`docs/privacidad-seguridad.md`](docs/privacidad-seguridad.md).
