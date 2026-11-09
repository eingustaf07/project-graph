# Project Graph E 1.5 account persistence and naming

Deployed to the local developer version on 2026-11-09 after explicit user authorization. Evidence is in `C:/Users/gustaf/Documents/PG-E15-Deployment-20261109`.

Native Windows metadata confirmed that ordinary and Codex-packaged launch contexts contain distinct encrypted ChatGPT credentials and distinct host IDs. The credentials remain encrypted with Windows DPAPI. The fix stores future credentials under the same user home at `.project-graph/credentials/chatgpt`, independent of version names and AppData virtualization.

On first use, when the canonical credential file is absent, read the latest legacy encrypted record from the known native, packaged and current-app locations. Validate DPAPI and JSON before writing a new encrypted canonical copy. Existing canonical records, including signed-out records, take precedence on later launches. Reuse the host ID embedded in the selected credential. Old credential files remain intact. OAuth endpoints, scopes and the original API provider are unchanged.

The settings UI now distinguishes pending status reads and transient failures from a disconnected account. Retrying status does not call login or logout. Product and current-version log names use `Project Graph E 1.5` with spaces. Application identifier and main binary name remain stable to preserve profiles and entry points.

GitHub Actions run 42635890712 compiled the Windows developer shell from 1d055e26a0806598532d1d0f8da5a0b95766b38c. Both Rust credential-directory/migration-selection tests and both settings UI tests passed, together with type-check. The later frontend checkpoint change was type-checked locally. The downloaded ZIP matched GitHub's SHA-256 digest; the deployed EXE SHA-256 is D55A5CF7D43AFD08C8EEE93F77072DEDC36236F5ACA40884167020BBB2EB4D57. Native source is unchanged since the CI revision.

Real WebView inspection confirmed the canvas, window title `Project Graph E 1.5 开发版`, and About heading `Project Graph E 1.5 / v1.5.0`. Credential migration produced the canonical encrypted file. The native status command returned connected=true and hasPlanAccess=true before and after a full native restart without signing in again. One initial token-refresh request hit a transient network error; retry succeeded. No tokens or account identifiers were printed. The temporary debugging endpoint was removed by restarting normally after verification.

The existing settings and shortcuts were compared semantically against pre-deployment backups: settings.json and keybinds2.json have no differing values. Other profile JSON file hashes were unchanged. Original credential files, source changes and projects were retained. Native AssocQueryString, launcher registry and the shared Start menu shortcut all resolve to the deployed physical executable. Actual Alt/Win key injection and visual taskbar grouping were not tested because desktop automation was unavailable.

The current empty draft restored with matching object count and camera across the native restart. This is not a new large-project performance or complete feature regression test. No new AI generation request or new authorization flow was exercised. Officially expired or revoked authorization can still require login. Old EXE/profile backups are retained in the evidence directory.
