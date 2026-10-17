# MUKE server migration — preview 0.1

This is a staged server migration, not a replacement HR database. Lark Base remains the source of record. The public recruitment frontend stays in `inetcoding/muke/portal`; the service and internal entry points stay in `inetcoding/MSOP/platform`.

## What is implemented

- Bilingual recruitment homepage, job search, priority filter and job details, using the existing published jobs schema.
- Candidate referral aliases `a/agent/s/scout/r/ref` and `done` return links are forwarded to the established application flow. With `APPLICATIONS_ENABLED=0` (default), application links continue to the current inetcoding site with the complete query string.
- Scout PIN verification happens on the server using the existing PBKDF2/AES-GCM format. Plaintext PINs are not stored; session cookies are HttpOnly. A changed/removed encrypted panel invalidates its session. Blank invitation URLs remain blank.
- HR Lark OAuth with PKCE/state, exact tenant validation and an explicit administrator open-ID allowlist. HR workspace links open existing Lark pages; this version does not submit personnel mutations.
- Private hourly sync worker, scheduled 09:00–22:00 Asia/Jakarta. Existing generator checks run with strict publication, and a successful generation is exposed by an atomic pointer switch. A failed generation leaves the previous one active. No notification messages are sent.
- Docker Compose preview on server loopback, plus optional Caddy HTTPS configuration. No third-party npm runtime dependencies.

## Workflow dependency contract

| Business function | Data source | Execution / existing flow | New code | Credential boundary |
|---|---|---|---|---|
| Public job list and JD | A01, H22 | Existing sync generator | muke/portal; platform/sync.mjs | Read application on server |
| Agent attribution and departure handover | A02, A03, H01 | Existing A02/AnyCross publication; generator handover rules | Existing muke/join and tools/sync-portal.js | No browser credentials |
| Scout attribution and PIN | A04 | Existing Base PIN provision; read-only encrypted projection | platform/security.mjs, /api/partner/* | PIN verified server-side |
| CV submission | A05, H28 | Existing Lark public form and Base automation | Existing join flow | Candidate enters Lark form |
| Background questionnaire | A06, H28 | Existing position-specific Lark form | Existing join flow | Candidate enters Lark form |
| Exam | A07, H28 | Existing position-specific Lark form | Existing join flow | Candidate enters Lark form |
| Interview and evaluation | A08, A09 | Existing Lark process | Authenticated HR handoff links | Existing Lark user permissions |
| Employee creation | H01 and upstream evaluation | Existing Base/AnyCross triggers | Handoff only in preview | Existing business applications |
| HR identity | Lark OAuth tenant + app-scoped open_id | Server allowlist, then Lark's own permissions | platform/lark.mjs, server.mjs | Separate login app variables |
| Attendance / transfers / onboarding messages | H02 onward, AnyCross | Existing published versions | Not migrated in this preview | Existing credentials retained |

The early handover inventory used different A-table descriptions. IDs and generator contracts inspected in the source take precedence. Confirm Base labels and field metadata before adding write APIs.

## Local verification

Use Node 24 or later. From this directory:

```sh
npm test
node server.mjs
```

Set `MUKE_REPO` to a complete sibling muke checkout if the default layout differs. Put a copy of already published JSON in `.runtime/seed` for local preview only. `.runtime`, `.env`, sessions and sync credentials must never be committed. The service does not serve its source tree or the complete data directory: only jobs/manual/bench and validated j/s attribution routes are public.

Tests exercise the real request handler in process, including private-file denial, role isolation, CSRF origin checks, PIN authentication, cipher revocation, and unchanged application query strings. Real browser layout, external Lark OAuth, live sync, Docker build and HTTPS require deployment validation; passing these tests does not claim those integrations work.

## Server preview

Prerequisites: Debian 13, Docker Engine + Compose, git and curl. Keep complete repositories at `/opt/muke/repos/muke` and `/opt/muke/repos/MSOP`. Use the migration branches and review their revisions. Do not move the existing GitHub Pages branch.

```sh
cd /opt/muke/repos/MSOP/platform/deploy
sh prepare.sh
```

This copies already public snapshots to `/var/lib/muke/seed`, creates a private `.env` template if absent, builds the service, and binds only `127.0.0.1:8080`. It does not change DNS, security groups, Lark business records or workflow states. Sessions are held in memory and intentionally disappear when the app restarts. Source data and sync generations persist on disk.

Use an SSH local port forward to preview on your computer. View `/`, `/hr/` and `/partner/`. Application submission remains on the current site until explicitly enabled.

## Before public cutover

1. Enter server-side read credentials locally in `.env`; never copy real values into GitHub or chat. Run `docker compose run --rm sync node sync.mjs --once`, check it succeeded, and compare job/referral counts and samples. Configure `SYNC_ENABLED=1` only after this passes. Existing GitHub sync remains active until server scheduling has been observed.
2. Configure the Lark login application's exact callback `https://hr.muke.media/auth/lark/callback`, tenant key, and HR allowlist. Open IDs are application-specific; H01's existing OID/LUID must not be assumed compatible. Validate approved and unapproved users in a real login.
3. Confirm field keys and the complete CV → questionnaire → exam path, including prefill/hide parameters, form return URLs and referral persistence across origins. Only then set `APPLICATIONS_ENABLED=1`.
4. Inspect the published AnyCross version separately from its draft. Do not publish a draft merely to change a URL. Do not enable all inactive Base automations. Verify idempotency and existing triggers before implementing HR mutations.
5. Replace Base formulas/buttons/messages, AnyCross published URL templates, Lark document iframes and future invitations with final domains only after verification. Previously issued links/QR codes need a separate compatibility plan; old-owner Pages cannot be controlled here.
6. Add only jobs/hr DNS records to the new server. Preserve root/www/demo and mail records. Open web ports only when ready, set production HTTPS origins, `NODE_ENV=production`, `TRUST_PROXY=1`, then enable the Compose `public` profile. No plain-HTTP authenticated public rollout.
7. Verify HTTPS, OAuth, unauthorized access, mobile layout, live forms, sync failure retention and a scheduled sync. Keep the GitHub version available for rollback.

## Operational limits and recovery

- Scout login is off by default (`SCOUT_LOGIN_ENABLED=0`). Enable it only after a live successful sync and active/inactive account tests. A successful sync less than 26 hours old is required; failed or stale sync blocks access. Inactive scout status also blocks login. Session revocation follows the next successful sync, with a maximum session lifetime of 30 minutes. Changes in Lark are not instant push notifications.
- HR is an entry-point release, not a completed recruitment CRM. Attendance, transfers, field editing and workflow execution have not been recreated.
- Generation directories are retained for rollback; monitor disk usage. Failed generation cleanup and retention automation are not yet included. Do not expose `/var/lib/muke` via a generic file server.
- A stale `sync.lock` causes the worker to fail closed. Before removing it, confirm no sync process is running. Restart app services to revoke all sessions.
- Rollback source commits with normal git checkout after preserving configuration, then rebuild. To roll back data, replace `CURRENT` atomically with a previously validated generation name. Never copy private runtime files to the repositories.
