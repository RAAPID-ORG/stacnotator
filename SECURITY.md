# Security Policy

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security problem.**
Public reports expose deployments that have not patched yet.

Report it through **GitHub private vulnerability reporting**: open a draft advisory
from the [Security tab](https://github.com/RAAPID-ORG/stacnotator/security/advisories/new)
of this repository. Only the maintainers can see it, and the report stays private
until we publish it together. You can attach files and keep the whole conversation
in that one thread.

If you cannot use GitHub for any reason, email `rsawahn@umd.edu` instead with
`SECURITY` in the subject line.

If you are unsure whether something counts as a vulnerability, report it privately
anyway. We would rather triage a non-issue than see a real one posted publicly.

## What to include

The more of this you can give us, the faster we can confirm and fix:

- What kind of issue it is (auth bypass, SSRF, injection, token leak, ...)
- The affected component: backend (`backend/`), frontend (`frontend/`), SDK (`sdk/`),
  tiler (separate repo `stacnotator-tiler`), or deployment config (`deployment/`)
- Version, commit SHA, or deployed URL you tested against
- Steps to reproduce, ideally a minimal request or script
- Impact you were able to demonstrate, and anything you think might be reachable
  from it that you did not test

Proof-of-concept code is welcome. Please keep it in the private report.

## Our process

- **Acknowledgement within 5 working days.** This is a small research team, so
  responses outside that window can happen; a nudge in the advisory thread is fine
  if you hear nothing.
- We confirm the report, agree on severity with you, and tell you our planned fix
  and timeline.
- We fix on a private branch, release, and then publish a GitHub Security Advisory.
- **Disclosure is coordinated.** We aim to publish within 90 days of the report, or
  sooner once a fix is out and deployments have had a chance to update. If you plan
  to disclose on your own schedule, tell us early so we can line the dates up.
- We credit reporters in the advisory by whatever name or handle you choose, unless
  you prefer to stay anonymous.

There is no bug bounty for this project.

## Scope

This project is pre-release alpha software (see the note in the README). Treat it
accordingly: we do not recommend running it with sensitive data until a stable
release.

**In scope** - anything in this repository, including:

- Authentication and authorization: session handling, the `local` and `firebase`
  auth providers, organization/project/campaign access checks
- Data isolation between organizations, projects, campaigns, and users
- The visualizer route, which is the one surface reachable without an account
- Server-side request forgery through user-supplied URLs (STAC catalogs, COG and
  PMTiles layer URLs) that gets past `backend/src/net_guard.py`
- Handling of provider API keys, which are encrypted at rest by
  `backend/src/crypto.py`
- Minting and verification of tiler access tokens (`backend/src/tilers/tokens.py`)
- Injection, deserialization, and path traversal in backend endpoints
- Secrets or credentials committed to the repository or baked into images

**Out of scope**:

- Vulnerabilities in third-party services we integrate with (Microsoft Planetary
  Computer, Planet, Google Earth Engine, Firebase). Report those to their vendors.
- Findings that only apply to the dev stack's deliberately insecure defaults
  (`.env.example`, `docker-compose.dev.yml`, the built-in `local` admin user).
  Production config is validated separately by `_validate_production_config()`.
- Missing hardening headers or best practices with no demonstrated impact, and
  scanner output without a working proof of concept
- Denial of service through raw traffic volume, social engineering, and physical
  attacks

## Supported versions

We ship from `main` and only patch the latest release. If you run a fork or an older
deployment, update before reporting.

## Deploying safely

If you self-host, `docs/development.md` and `deployment/azure/README.md` cover the
production configuration. At minimum: replace every dev-default secret, keep
`ENVIRONMENT=production` set so the config validation runs, and do not expose the
database or the tiler directly to the internet.
