**Security audit — 10 September 2026**

**Remediation update:** The follow-up change addresses SEC-01 through SEC-07 with
Next.js 15.5.25, React/React DOM 19.1.9, a patched PostCSS override, Node 24 container
and CI images, bounded streaming downloads, shared persistent password throttling,
enforced body/file/storage/concurrency limits, atomic upload publication and cleanup,
and revocable persistent session records. Reserved/hidden upload names are rejected
as part of upload validation. The findings and evidence below describe the original
audited code and are retained as a historical record. SEC-08 and the remaining
deployment/browser observations require separate follow-up. The Node 24 production
Docker build passed, all 16 security regressions and 20 Playwright tests passed,
and both production and full npm audits reported zero vulnerabilities. See the
[remediation evidence](docs/security/remediation-evidence-2026-09-10.json).

The highest priorities are updating Next.js and bounding resource use on public downloads. The audit identified **two high, five medium, and one low severity findings**, plus smaller integrity and deployment concerns. Application authorization checks held in the tested cases. No authentication bypass or remote code execution was demonstrated.

This review covers revision `fa2941f` **and the pre-existing uncommitted changes**, including HTTP Basic authentication for uploads. Application source was left unchanged. Tests used copied source, synthetic credentials, and temporary uploads on a loopback-only standalone server. The actual deployment, reverse proxy, firewall, production secrets, container image contents, and the external deployment repository were not inspected. Ratings describe the application and checked-in deployment configuration; infrastructure controls may reduce exposure.

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| SEC-01 | High | Next.js is behind applicable security fixes | Installed/locked version and upstream advisory |
| SEC-02 | High | Public downloads allocate an entire file per request | Source and bounded memory reproduction |
| SEC-03 | Medium | Both password authentication paths allow unrestricted guessing | HTTP reproduction and source |
| SEC-04 | Medium | Upload and JSON body sizes lack application limits | HTTP reproduction and source |
| SEC-05 | Medium | Failed uploads leave permanent partial files and unhandled stream errors | Storage and HTTP reproductions |
| SEC-06 | Medium | Logout cannot revoke a copied session | HTTP reproduction |
| SEC-07 | Medium | Docker and CI use an unsupported Node.js release | Configuration and official lifecycle status |
| SEC-08 | Low | Request logs retain bearer download links and trust spoofable metadata | HTTP and logger reproductions |

**SEC-01 — Update the vulnerable framework and dependency tree**

Location: [package.json](file-share/package.json), dependency `next` at line 19, and [package-lock.json](file-share/package-lock.json).

Both the lockfile and installed modules contain Next.js **15.5.7**. The upstream December advisory identifies App Router applications in this release line as affected by a remotely triggered denial of service in React Server Component decoding, including CVE-2025-55184 and its follow-up fixes. This app uses App Router. This finding is based on the published affected version and source review; the CPU-hanging exploit was not executed. See the [Next.js security update](https://nextjs.org/blog/security-update-2025-12-11) and [maintainer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-mwv6-3258-q52c).

The current npm audit recommends **Next.js 15.5.25** as an available update within the same major version. Upgrade Next.js, align React and React DOM to a current compatible patch, refresh affected transitive dependencies, and rerun both audit modes and the functional tests. An update only to the December patch would miss later fixes. No dependency changes were applied during this review.

The registry reports critical alerts, but their prerequisites matter. The [Windows RCE](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) does not match the Linux Docker deployment. The [AVIF image optimizer RCE](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) requires image optimization: the effective configuration has `images.unoptimized: true`, and the optimizer endpoint returned 404. The [July Server Actions DoS](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj) explicitly requires a Server Action; this build's server action manifest is empty. These alerts are not counted as demonstrated critical vulnerabilities in this app.

The audit also flags `postcss`, `sharp`, `nanoid`, `uuid`, and development dependency `tar`. The application uses UUID v4, not the v3/v5/v6 buffer APIs named in the UUID alert. No path accepting user CSS for compilation or extracting uploaded archives was found. Update these packages, but do not equate each registry alert with a reachable application exploit. Full registry output is retained in the evidence files.

**SEC-02 — Public downloads can exhaust memory**

Locations: [storage.ts](file-share/lib/storage.ts), lines 253–267; [download route](file-share/app/f/[uuid]/[filename]/route.ts), lines 16–31.

`getFile()` uses `fs.readFile()` to allocate the complete file before responding. Wrapping the resulting buffer in a `ReadableStream` does not make the disk read incremental. Anyone possessing a valid share link can trigger this work without an admin session. Concurrent requests for a large shared file can exhaust process or container memory and interrupt all users. The missing upload bound increases the possible amplification.

A bounded storage probe made four concurrent reads of a 16 MiB synthetic file. It returned four separate 16 MiB buffers and increased `arrayBuffers` memory by **67,135,096 bytes**, approximately 64 MiB. Anonymous HTTP download behavior was independently verified. No out-of-memory attack was performed, and a production failure threshold was not measured.

Fix: stream from disk with backpressure, close the file on cancellation, and handle read errors. Use file metadata for content length rather than allocating the contents. Add sensible download concurrency/rate controls and test slow or disconnected clients. Acceptance: concurrent downloads should use bounded buffers rather than memory proportional to total file sizes.

**SEC-03 — Credential guessing is unrestricted**

Locations: [login route](file-share/app/api/auth/login/route.ts), lines 5–28; [auth.ts](file-share/lib/auth.ts), lines 5–6 and 25–33; [upload route](file-share/app/api/upload/route.ts), line 12.

The login endpoint and HTTP Basic upload endpoint compare credentials without throttling, backoff, or an attempt budget. Twenty-five successive wrong passwords on each endpoint all returned 401 with no 429 or retry policy. Source review found no shared rate limiter. A remote attacker can keep guessing the single administrator's password; success grants access to file management. A limiter only on the login form would leave the Basic authentication path exposed.

Fix: enforce a shared authentication attempt policy for both paths, combining account and trusted client identity limits with progressive delays and monitoring. Avoid a permanent account lock that attackers could use to deny access. Verify any proxy-based protection covers both endpoints and cannot be bypassed through direct origin access. Acceptance: repeated failures on either path consume the same account budget and eventually receive controlled throttling.

**SEC-04 — Documented size limits are not enforced**

Locations: [storage.ts](file-share/lib/storage.ts), lines 71–73 and 107–116; [login route](file-share/app/api/auth/login/route.ts), line 7; [note route](file-share/app/api/note/route.ts), line 16. The upload UI also advertises a 100 MB maximum.

The application never reads `MAX_FILE_SIZE`; Busboy has no configured file, file-count, or part-count limits. The note and login routes call `request.json()` without an application byte limit. Uploading requires admin credentials, but the login body parser is public. A compromised admin session, faulty integration, or accidental oversized upload can consume disk space; large or concurrent JSON requests can consume memory. There is also no total storage quota.

With the isolated server configured as `MAX_FILE_SIZE=1024`, an HTTP upload of **2,048 bytes returned 200** and persisted all bytes. A 2,048-byte note likewise returned 200. No oversized production traffic was sent.

Fix: validate a positive configured limit at startup, enforce streaming byte limits independently of `Content-Length`, set multipart limits, reject excess data with 413, and remove partial output. Bound JSON parsing on login and notes before buffering, and apply explicit string/type limits. Add a total storage budget. Acceptance: boundary-size uploads succeed, oversized and chunked bodies fail promptly, and rejection leaves no files.

**SEC-05 — Interrupted uploads become permanent partial files**

Locations: [storage.ts](file-share/lib/storage.ts), lines 102–141, 161–170, and 308–309.

The final upload directory is created immediately, but the `.autodelete` marker is written only after the disk write finishes. The error paths reject the promise without removing the directory or consistently destroying the connected streams. Cleanup skips directories with no marker, which is also how intentionally pinned files are represented.

A simulated disconnect after 65,536 bytes left a visible partial file with `autoDelete: false`. Even cleanup invoked with an age threshold of `-1` skipped it. Failed uploads can therefore retain sensitive fragments indefinitely and accumulate storage despite the advertised expiry behavior.

The per-file Busboy stream also lacks an error handler. A truncated multipart body caused an unhandled `FileStream` error and exit code 1 in an isolated storage process. In the actual standalone HTTP server, the same class of request produced 500 and an `uncaughtException` log; the next health request still returned 200. A production server crash was **not** demonstrated.

Fix: write into a dedicated temporary area, propagate errors/cancellation through the whole pipeline, and remove temporary content on every failure. Publish a completed file and its retention metadata atomically. Periodically reclaim abandoned temporary uploads. Acceptance: malformed bodies, disconnects, write failures, and size-limit failures leave no published partial file or uncaught exception.

**SEC-06 — Logout only clears the caller's cookie**

Locations: [auth.ts](file-share/lib/auth.ts), lines 39–46; [session.ts](file-share/lib/session.ts), lines 3–16.

The encrypted session contains only administrator/login booleans and a 24-hour expiry. `logout()` calls `session.destroy()`, which clears the browser cookie. There is no server-side session identifier, revocation record, or account session version to invalidate an already copied token.

Reproduction: authenticate, retain the synthetic session cookie, POST logout (200), then replay the retained cookie to `/api/files`: **200**. An attacker who already acquired a session retains access after the owner logs out. Password changes also are not consulted during existing-session validation, as shown by the source; that separate scenario was not tested dynamically. The test did not demonstrate cookie theft or forgery.

Fix: add a random server-side session identifier with revocation, or an account session generation checked on each request. Revoke sessions on logout and credential rotation. Rotating `SESSION_SECRET` can provide emergency global invalidation. Acceptance: a pre-logout cookie must subsequently receive 401.

**SEC-07 — Node.js 20 is unsupported**

Locations: [Dockerfile](file-share/Dockerfile), lines 2 and 25; [build workflow](.github/workflows/build-and-push.yml), line 28.

Both Docker stages use `node:20-alpine`, and CI selects Node 20. At the audit date, the official project lists Node 20 as end of life. Unsupported releases no longer receive normal upstream security updates; a floating image tag does not restore runtime support. This is a confirmed lifecycle/configuration issue, not a container CVE scan. See the [Node.js release status](https://nodejs.org/en/about/previous-releases) and [EOL policy](https://nodejs.org/en/about/eol).

Fix: migrate build, runtime, and CI to a supported LTS, such as the current Node 24 LTS, rebuild the image, and run the Docker test suite. Keep the base image updated and scan the actual release image. Local audit execution used the available Node 22.22.1 and did not validate the production Node 20 container.

**SEC-08 — Logs expose download capabilities and accept forged metadata**

Locations: [server-wrapper.js](file-share/server-wrapper.js), lines 16–35; [request-logger.js](file-share/lib/request-logger.js), lines 39–60; [storage.ts](file-share/lib/storage.ts), lines 104 and 326.

Full download URLs, including the UUID and filename needed to access a file, are retained in request logs. Upload/debug and cleanup messages also contain reconstructable paths. Anyone with access to forwarded logs or log backups may gain access to still-available files, even if file access was not part of their role. A local download's full bearer URL appeared in the log.

The wrapper also trusts incoming `cf-connecting-ip` without checking the connecting proxy. A direct request supplying a synthetic address caused that address to be logged. The country and Cloudflare ray fields are not sanitized: embedded tabs expanded an 11-column test entry to 13 columns. These findings affect log confidentiality/integrity; they do not currently bypass an application IP access rule because no such rule exists.

Fix: redact or keyed-hash download identifiers consistently across request and debug logs, remove sensitive query/referrer data, restrict log access, and set retention/size limits. Trust forwarded identity only from a configured proxy boundary, and encode every field using structured logging. The live proxy may already sanitize forwarded headers; that boundary remains unverified.

**Additional observations**

- **Filename/metadata collision:** uploading `.autodelete` returned success and reported 38 bytes, but marker creation overwrote the uploaded contents to zero bytes. Uploads beginning with `.` are also omitted by `listFiles()`; a synthetic `.private.txt` upload succeeded but was absent from the listing. Cleanup can treat these as empty directories. Reject reserved names, empty/dot names, and unintended hidden names, or store metadata separately from user filenames. This is a reproduced data integrity issue.
- **Browser and request hardening:** the direct app response had no CSP, framing restriction, `nosniff`, or explicit referrer policy. Downloads use `attachment`, which is a useful protection. Add headers appropriate to the app, validate Origin/Fetch Metadata on cookie-authenticated mutations, and verify HTTPS/HSTS at the proxy. `SameSite=Strict` already mitigates ordinary cross-site cookie CSRF; no general CSRF or stored-XSS exploit was demonstrated.
- **Expiry semantics:** downloads do not check age; deletion is periodic, every 30 minutes, and browser responses are cacheable for one hour. The README discloses the cleanup interval. If links need a strict expiry/revocation guarantee, validate expiry on each read and use an appropriate cache policy. Previously downloaded copies cannot be revoked.
- **Build/deployment controls:** `.dockerignore` enumerates several `.env` filenames but misses `.env.production`/`.env.development` and does not exclude logs. Prefer a complete `.env*` exclusion and exclude logs from build contexts. CI does not run a dependency/image security check, and the publishing workflow has no dependency on the separate test job. Prefer minimum workflow token permissions, immutable action references, and a release gate on tests/security checks. No leaked production secret or malicious CI action was demonstrated.

**Validation and evidence**

- A fresh isolated production build succeeded, including TypeScript validation. It used `next build` with the default webpack bundler; the repository's normal build script specifies Turbopack. The standalone server used the repository's logging wrapper and effective `next.config.js` configuration.
- The existing Playwright suite passed **16/16 tests in 4.9 seconds** against that server.
- Unauthenticated list, upload, note, delete, and pin/unpin requests all returned 401. Invalid session cookies returned 401. Three representative encoded path-traversal probes returned 404. Production cookies included `Secure`, `HttpOnly`, and `SameSite=Strict`.
- Both `npm audit --omit=dev --json` and `npm audit --json` were run against the current registry. Their aggregate metadata reports 5 affected production entries and 6 overall; detailed package entries and applicability are retained rather than treating those totals as exploitable findings.
- A limited pattern scan of 61 tracked text files found no private-key headers, GitHub tokens, or AWS access-key IDs. It did not cover historical commits, all secret formats, binary demo media, or real deployment configuration.

Machine-readable [probe evidence and source hashes](docs/security/audit-evidence-2026-09-10.json), [production dependency audit](docs/security/npm-audit-production-2026-09-10.json), and [complete dependency audit](docs/security/npm-audit-all-2026-09-10.json) accompany this report. Evidence contains synthetic test identifiers and no session-cookie values.

Fix SEC-01 and SEC-02 first, then implement authentication limits and reliable bounded upload handling (SEC-03 through SEC-05). Add session revocation and upgrade the runtime in the same hardening cycle. Each finding includes an acceptance condition or verification step for the follow-up fixes.
