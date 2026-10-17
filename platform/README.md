# MUKE server migration — preview 0.1

This is a staged server migration, not a replacement HR database. Lark Base remains the source of record. The public recruitment frontend stays in `inetcoding/muke/portal`; the service and internal entry points stay in `inetcoding/MSOP/platform`.

## Deployment checkpoint — 2026-10-18 Asia/Jakarta

- `https://jobs.muke.media/` and `https://hr.muke.media/` are served by the Debian Docker deployment with valid Let's Encrypt certificates and HTTP-to-HTTPS redirects. The HR hostname opens `/hr/`.
- Initial direct Lark synchronization succeeded at `2026-10-17T18:41:00.125Z`, publishing 7 jobs with snapshot date `2026-10-18`. The server scheduler is enabled for 09:00–22:00 Asia/Jakarta; a future scheduled execution has not yet been observed.
- The existing read application is reused through a private server configuration. No Lark business records or AnyCross versions were changed. GitHub synchronization remains available for the existing application flow.
- Browser checks passed for language switching, search, priority filtering, job details, existing application redirection, and 390px layouts without horizontal overflow. Public unauthorized HR access returns 401; private data and source paths return 404.
- Lark's exact HR callback is registered. The company owner's Lark identity was verified live, bound to the exact tenant and application-scoped open-ID allowlist, then successfully used to open the HR workspace showing its six Lark handoff links. The allowlist currently contains one account; real identity values remain only in the private server configuration. Temporary identity-only setup is now disabled. Eleven local security and job-management tests pass, including unapproved/wrong-tenant rejection; a second real Lark account has not been tested.
- Scout login remains disabled. Applications still redirect to the existing inetcoding GitHub Pages flow; form return URLs and attribution must be validated before switching it.

## What is implemented

- Bilingual recruitment homepage, job search, priority filter and job details, using the existing published jobs schema.
- Candidate referral aliases `a/agent/s/scout/r/ref` and `done` return links are forwarded to the established application flow. With `APPLICATIONS_ENABLED=0` (default), application links continue to the current inetcoding site with the complete query string.
- Scout PIN verification happens on the server using the existing PBKDF2/AES-GCM format. Plaintext PINs are not stored; session cookies are HttpOnly. A changed/removed encrypted panel invalidates its session. Blank invitation URLs remain blank.
- HR Lark OAuth with PKCE/state, exact tenant validation and an explicit administrator open-ID allowlist. HR workspace includes a live job catalog and private change drafts. Personnel actions remain links to existing Lark pages; this version does not submit Lark business mutations.
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
   If the app-scoped identity is not known, temporarily set `HR_IDENTITY_SETUP_ENABLED=1` with the login app credentials. OAuth verification creates only a 10-minute identity session, showing that user's own name, tenant key and open ID. It provides no HR access, makes no Base writes and does not persist Lark tokens. Verify the intended company/account before configuring its tenant and allowlist, then set this flag back to `0` and restart the app to clear temporary sessions. When a tenant is already configured, other tenants are rejected even in setup mode.
3. Confirm field keys and the complete CV → questionnaire → exam path, including prefill/hide parameters, form return URLs and referral persistence across origins. Only then set `APPLICATIONS_ENABLED=1`.
4. Inspect the published AnyCross version separately from its draft. Do not publish a draft merely to change a URL. Do not enable all inactive Base automations. Verify idempotency and existing triggers before implementing HR mutations.
5. Replace Base formulas/buttons/messages, AnyCross published URL templates, Lark document iframes and future invitations with final domains only after verification. Previously issued links/QR codes need a separate compatibility plan; old-owner Pages cannot be controlled here.
6. Add only jobs/hr DNS records to the new server. Preserve root/www/demo and mail records. Open web ports only when ready, set production HTTPS origins, `NODE_ENV=production`, `TRUST_PROXY=1`, then enable the Compose `public` profile. No plain-HTTP authenticated public rollout.
7. Verify HTTPS, OAuth, unauthorized access, mobile layout, live forms, sync failure retention and a scheduled sync. Keep the GitHub version available for rollback.

## Operational limits and recovery

- Scout login is off by default (`SCOUT_LOGIN_ENABLED=0`). Enable it only after a live successful sync and active/inactive account tests. A successful sync less than 26 hours old is required; failed or stale sync blocks access. Inactive scout status also blocks login. Session revocation follows the next successful sync, with a maximum session lifetime of 30 minutes. Changes in Lark are not instant push notifications.
- HR includes job viewing and private draft preparation, not a completed recruitment CRM. Publishing drafts, attendance, transfers and workflow execution have not been enabled.
- Generation directories are retained for rollback; monitor disk usage. Failed generation cleanup and retention automation are not yet included. Do not expose `/var/lib/muke` via a generic file server.
- A stale `sync.lock` causes the worker to fail closed. Before removing it, confirm no sync process is running. Restart app services to revoke all sessions.
- Rollback source commits with normal git checkout after preserving configuration, then rebuild. To roll back data, replace `CURRENT` atomically with a previously validated generation name. Never copy private runtime files to the repositories.

## Job management stage — 2026-10-18

`/hr/jobs/` is available only to the existing tenant/open-ID allowlist. Its API reads the minimum recruitment fields from A01/H22/H28 using the existing read credential; it does not read applicant identities or employee profiles. A successful result is cached for at most 60 seconds. Field-type mismatch or incomplete pagination fails closed. No stale result is substituted for a failed fresh read.

Live field inspection confirmed 16 A01 requirements and 51 H28 registry rows. A01 `Status` is a single-select with 未开始 / 进行中 / 已停止 / 已完成. `申请状态` is a separate approval result and is not editable in drafts. `Job-ID` and `JID` are lookups into H22; neither is a write target. `Goal` is numeric, 紧急程度 is a single-select, 到岗期限 is a date, and the two H22 JD columns are text. A01 also links to A02 tasks and A03 agents. New requirements need approval/automation review before a live create API can be introduced.

- View all positions, search, filter open/closed positions, inspect recruitment batches and H28 form readiness. “Configured” checks registry presence, unique mapping, inactive status and HTTPS Lark URL shape; it does not claim that form submission or return URLs have been tested.
- Prepare a draft for an existing batch or a new batch of an already configured position. Preview exact differences and the number of batches that would remain open. Editing the shared H22 JD warns that all batches use it.
- Save and archive drafts only in `/var/lib/muke-drafts/job-drafts.json`, a private app-only writable mount. Archive retains records. Writes use an in-process queue and atomic rename; deployment supports one app replica. Back up this directory separately alongside private deployment configuration.
- Drafts contain the source revision, exact before/after values, creation time and author. Duplicate submissions are idempotent while the matching draft remains active. Fresh Lark reads reject saves based on changed source data; saved drafts display a source-changed warning on later reads.
- There is deliberately no publish/write-to-Lark endpoint. Approvals, live A01 changes, the public generator, existing GitHub sync and candidate form return settings stay as they were. No public route serves draft files.

Before deploying this stage, create `/var/lib/muke-drafts` owned by UID/GID 1000 with mode 0750, then rebuild only `app`. This does not require restarting the sync worker. App restart expires existing HR sessions; sign in with Lark again. Local test fixture persistence is verified in a writable workspace temporary directory; tests do not create business records.

### Verified deployment result

The draft-only job stage was deployed from commit `7be28edcc6989bd577beef8fc342acabcb485866`. Both Windows workspace tests and the Debian container passed all 11 tests. The live read returned 36 H22 positions, 16 A01 requirements, 7 open positions/7 active batches, and zero unmatched A01 positions. All 7 open positions have unique, non-disabled HTTPS Lark CV/background/exam registry links; actual form return behavior remains unverified.

The allowlisted owner signed in successfully after the app restart. Browser verification passed for the live catalog, search, existing batch details and a non-persisted change preview. The test preview was closed without saving; the live draft count remained zero. The 390px layout had no horizontal overflow. Anonymous job/draft APIs returned 401 and the private draft filename returned 404. Existing application redirects retained the entire referral query. The sync worker was not restarted.

## Server publication evidence — 2026-10-18

Server sync now checks complete API pagination and verifies the exact A01 recruitment `Status` field independently from approval status. A private `_job-source.json` checkpoint records requirement IDs and their explicit states. Normal batch stops, all positions closing, and reopening are supported when consistent with a previously verified source. Missing pages, API errors, replaced status fields, unknown states, deleted requirements, reassigned previously active requirements, output/source mismatches and erased existing JD text stop publication and retain the prior generation. A01 being completely empty is treated as a source problem, not an instruction to close recruitment.

The old file-size heuristic is replaced only for the server mode by these source checks. Other sensitivity, referral, field-contract and link checks remain enabled. A source baseline is established on a successful sync; a first run that would retire already published jobs is blocked for review. Do not delete the checkpoint to force a change through. After legitimate record deletion or schema changes, an operator must review the data before deliberately reconciling the baseline.

Empty verified job lists have their own public “no open positions” message. The strict contract validates every job when present and accepts an empty collection. Published-agent checks exclude positions explicitly closed in the known job catalog. Unknown/unmapped task positions remain checked. No Lark state is altered by this change, and no notifications are sent from the server worker.

The HR job page shows the last successful website sync and a failure indication when the latest attempt failed. Schedule remains 09:00–22:00 Asia/Jakarta; failed hourly runs are retried at the next scheduled slot. A manually triggered `node sync.mjs --once` is available to the server operator. Seventeen tests cover the live generator against synthetic inputs, normal/complete stops, reopening, pagination failures and atomic preservation of a prior generation. Tests never stop real jobs.

Deploy the matching migration branches of both repositories before rebuilding app and sync; `platform/sync.mjs` depends on `muke/tools/publication.js`. Run container tests, then a single read-only-source sync to establish the checkpoint. Recreate the services only after this succeeds. App recreation expires HR sessions.
