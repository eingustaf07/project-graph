# PG1.4 development

Baseline: PG1.3 1.3.1, commit `636f6ed46252ca5d2c444a818accc1312369ce8c` on `pg13-clipboard-20261030`. The working tree was clean before branching; there were no uncommitted user changes to protect.

Development branch: `pg14-copy-shortcuts-20261031`. The installed PG1.3 and its settings are not modified by this source-only work. Existing internal identity remains unchanged to preserve settings and authentication on a future upgrade.

- Ctrl+C immediately copies selected nodes with their links, styles and layout.
- Ctrl+C followed by Ctrl+C within 350 ms copies selected node text. Ctrl may stay held between presses.
- Both commands are editable in Settings > Shortcuts > Basic, as Copy Nodes and Copy Text. Existing custom key bindings remain intact; only the new command receives its default when missing.
- Keyboard auto-repeat does not count as a second press. Input fields keep native text copying, and focus/project changes end the sequence.
- Clipboard writes are ordered across projects, and immediate paste waits for a pending copy.
- No installer is generated or installed during this development change.

All PG1.3 features remain on this branch. Build and installation require a later packaging request.

Validation: the pre-change copy/shortcut baseline passed 29 tests. After the change, 87 related tests passed across copy/paste, keyboard sequences, drawing and geometry. Type checking and lint passed. Tests cover physical double presses versus auto-repeat, text inputs and shortcut recording, focus/project changes, configurable sequences, slow attachment preparation, overlapping clipboard writes, and immediate cross-project paste. Local checks used Node 24.19.0; the project requests Node 26. No PG1.4 native build or desktop acceptance test has been run yet.

The generated zh_TW locale was refreshed from zh_CN using the existing sync-locales command; it also includes translations already present in PG1.3's source locale. The Windows packaging configuration now uses the configured product name to find the installed executable and labels future artifacts PG1.4. Automatic packaging remains disabled for this development branch.

## Sound effects volume

Settings > Customization > Sounds now includes Sound effects volume (%), a 0–100 slider with numeric input. It uses the existing settings store, defaults to 100 to preserve original loudness, and applies a shared Web Audio gain to every PG effect, including preview and custom-file effects. Changes smoothly affect playing sounds as well as subsequent effects. System volume is not accessed. The existing sound switch, effect paths and pitch settings remain unchanged.

Validation: 8 sound/settings tests and 49 copy/keyboard regression tests passed. Tests cover all sound entry points, saved volume, live gain, mute/restore, the original disabled/empty-path behavior, settings reload and preservation of unrelated settings. Type checking and ESLint passed. Local Node is 24.22.1 (project requests >=26). No native playback/listening acceptance test, build or installation was performed for this addition.

## Credits, extension market and PG account

The custom build omitted LR_API_BASE_URL. Credits requested an undefined base, both market commands handed Windows `undefined/ext/marketplace`, and the account feature flag disabled the login form. A shared, validated cloud URL resolver now defaults absent/blank configuration to https://hub.graphif.dev while preserving explicit HTTP(S) server overrides. Invalid explicit configuration disables authentication safely and produces an error for public links. Auth uses the existing email/password client and Tauri transport; the account registration link uses the same resolved base. ChatGPT login and existing AI providers are unchanged. The existing telemetry and AI feature flags keep their previous explicit-configuration behavior.

Credits check HTTP status and response shape before rendering, with a visible error and Refresh retry. Both the extensions page and existing market command use the resolved URL and report browser-launch errors. No shortcut bindings, profile files or project files are modified.

Live unauthenticated probes on 2026-11-01: donations HTTP 200, 310 valid records; marketplace HTTP 200 HTML; auth get-session HTTP 200 with null (expected when not logged in). The official site's donate link redirects to hub.graphif.dev/ext/donate, independently confirming the service host. Sources: https://graphif.dev/donate and https://hub.graphif.dev/ext/marketplace .

Validation: 18 cloud configuration/client/rendered-page tests and 57 existing copy/keyboard/sound/settings regression tests passed. The real account SDK was exercised against a mocked Tauri transport for login routing and server rejection, not a real user's login. Type checking and ESLint passed. Native desktop navigation, real account login, cloud sync/backup and session persistence have not been accepted on the installed app. No packaging or installation was performed.
