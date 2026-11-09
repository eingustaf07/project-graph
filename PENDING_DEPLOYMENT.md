# Project Graph E 1.5 account persistence and naming

User explicitly requested source repair only on 2026-11-09. Do not deploy.

Native Windows metadata confirmed that ordinary and Codex-packaged launch contexts contain distinct encrypted ChatGPT credentials and distinct host IDs. The credentials remain encrypted with Windows DPAPI. The fix stores future credentials under the same user home at `.project-graph/credentials/chatgpt`, independent of version names and AppData virtualization.

On first use, when the canonical credential file is absent, read the latest legacy encrypted record from the known native, packaged and current-app locations. Validate DPAPI and JSON before writing a new encrypted canonical copy. Existing canonical records, including signed-out records, take precedence on later launches. Reuse the host ID embedded in the selected credential. Old credential files remain intact. OAuth endpoints, scopes and the original API provider are unchanged.

The settings UI now distinguishes pending status reads and transient failures from a disconnected account. Retrying status does not call login or logout. Product and current-version log names use `Project Graph E 1.5` with spaces. Application identifier and main binary name remain stable to preserve profiles and entry points.

Validation completed locally: settings UI tests for pending-status restoration and transient-error retry. TypeScript type-check passes. Rust unit tests were added for the fixed directory and latest legacy selection, including signed-out precedence among legacy candidates. This machine has no Rust compiler/Cargo available, so these native tests and native compilation are still required on Windows before deployment. Do not claim that credential migration has already been run or that login across restart has been verified.

Before deployment, run native credential-store unit tests and the existing auth tests, then verify DPAPI persistence across normal Windows and packaged launch contexts without printing tokens. A revoked or expired authorization may still require official login. Preserve settings, shortcuts and projects, then verify .prg and Alt/Win+numpad4 entry points.
