# PG1.4 development

## NN latency on reciprocal arc edges (source fix)

Targeted reproduction on the supplied document found opposite ArcEdge connections between 工作上下文 and 筛选. Fast layout validated ordinary tree lines but recursed into the two arcs. NN on 提示词模板 took 37.6 s and threw a stack overflow in the model test. Fast layout now traverses the same solid tree lines as subtree movement and validation. The arcs remain in the document. After correction, NN on 提示词模板, 工作上下文 and 上下文窗口管理 measured 100–141 ms with collision enabled and each issued one editor request. Added a regression with two real reciprocal arcs. Installed PG1.3 UI timing and keyboard focus have not been verified with this source change.

### Earlier investigation before the specific branch was identified

Read-only reproduction used the user's supplied PRG (1187 objects, 592 text nodes) entirely in memory. Largest descendant-tree validation measured about 4 ms; source NN generation measured about 115 ms without ordinary-node collision and 387-390 ms with it. These model measurements do not reproduce the reported native PG1.3 6-10 second delay or prove a UI fix. Installed process was identified at the normal PG1.3 path; current effective runtime settings could not be confirmed from the stale profile snapshot.

Deep growth now skips root/validation scans when auto-layout and reset-to-tree camera are off; when layout is on it avoids a second identical validation. Editing is scheduled on the next event turn before layout, so layout exceptions cannot prevent the new node's editor request. New-node selection is independent of tree validity. Nineteen model/regression tests passed including the opt-in read-only actual-file test (PG_NN_READ_FILE and optional PG_NN_REPORT/PG_NN_COLLISION). Type-check/lint passed. PRG hash remained 307CDAC796A63227F2CD7CB92A6E6B4F5348CC88E9270DBE5F1D73EDE081C148. Source only; exact failing node/native settings/runtime reproduction still pending. No installed binary or user profile was changed.

## Right-click source selection and accidental self-loops

Right-button connection now retains selected sources captured at pointer-down instead of replacing them with the clicked target. This prevents small pointer movement from turning B→C into C→C. Both click and drag completion omit the target from selected sources; only no-selection fallback requests a self-loop, still governed by allowAddCycleEdge. The global self-loop policy and saved shortcut/settings values are unchanged. Seven controller interaction tests cover consecutive A→B/B→C, several jitter distances, selected-target filtering, no-selection fallback and disabled right-click connecting. Type checking and lint pass. Source only; native mouse acceptance remains pending.

## Container title visibility while zooming

Bounded/decorative doodle titles are rendered outside their frame, but section culling previously considered only the frame. The section draw pass now also checks title bounds, so an offscreen frame does not suppress an onscreen title. The title's measured width and zoom-dependent minimum font size determine eraser-mask padding; text alignment/baseline are explicit. Collision geometry and project/settings formats are unchanged. Fifteen focused rendering tests pass, including six zoom scales (0.01 through 16), an offscreen frame with a visible title, and empty-title behavior. TypeScript and lint pass. Source only; installed Windows wheel interaction is not yet verified.

## N-key container transfers

Added optional global control/section setting containerNBoundary (default off for existing profiles). When on, creation/content changes can grow bounded doodles even if containerAutoExpand is off, while movement through EntityMoveManager holds boundaries fixed. Hold N while dragging to enroll outside nodes or release members after their center crosses the boundary. Ordinary dragging does not enroll outside nodes. The movement context is restored in finally blocks; absolute-position moves also keep boundaries fixed. Existing explicit grouping APIs retain their behavior. Covers rectangle/circle walls, incremental exit, reentry, new content growth, undo/redo, binary serialization and preference persistence. 90 focused regression tests passed; follow-up absolute-move assertion passed in the 22-test Doodle suite. Source only, not installed or packaged. The setting applies to all bounded doodles, not individually per container. Native mouse acceptance remains pending.

## Keyboard deletion sound

The existing delete-selected command now plays one gentle cached 220 Hz tone only when the stage object count decreases after deletion. Existing key bindings, lock/background filtering and deletion/history behavior are preserved. A separate "快捷键删除对象" switch and preview are available in customization/sounds; master mute and volume also apply. Nine audio service tests pass, including deletion buffer reuse and mute. Source only; native listening and installation are pending.

## Resize after naming a container

Saving the inline title with Enter now closes the title input while keeping boundary editing active, so the four resize handles remain available. Clicking elsewhere still finishes boundary editing. React interaction coverage now drags a corner after each title change (including an empty title), checks geometry and title preservation, and checks history commits. The focused UI tests, TypeScript check and lint pass. Source only; installed Windows acceptance is pending.

## Doodle creation tone and independent sound switches

Successful freehand/straight strokes and rectangle/circle creation (including containers) now play a gentle cached 160 ms tone, lower in pitch than node creation. Clicks too small to create a stroke and edits/resizes do not trigger the creation tone. The existing sound settings page adds independent switches for all 16 configured effects, node creation, doodle/container creation and the custom-path/extension sound channel. Missing switch values default to enabled; changes persist in soundEffectEnabled without clearing file paths or changing shortcuts. The master mute and volume still apply, including checking mute again after audio loading/resume. Validation: 47 focused tests and TypeScript checking passed. Source only, not packaged or installed; native sound listening remains unverified. Node 24.22.1 is below the repository's requested Node 26.

## Gentle double-click creation sound

Successful double-click text-node creation now plays a cached 160 ms quiet sine-based tone with a smooth attack/release through the existing master volume gain. It respects soundEnabled and soundVolume and requires no external sound asset or decoding. Failed creation and non-left clicks do not play it. Tests cover all three mouse modes, failure gating, envelope endpoints/amplitude, buffer reuse and mute. Source only; perceived softness on the user's speakers remains for listening verification after running the updated version.

## Repeated doodle title editing

Drawing-mode doodle double-click no longer also opens the legacy section-title editor when the drawing toolbar is enabled. The toolbar commits a title only after its input was edited, preventing an old cached title from overwriting a rename performed through another entry point. React interaction tests cover repeated renames, empty titles and external title updates; real Doodle history/MsgPack tests verify the latest title persists. Source only; no native UI acceptance or installation.

## Double-click node creation in all mouse modes

Empty-canvas left double-click now uses the existing node creation action in select/move (ZZ), drawing (BB) and connect/cut (CC) modes. Drawing a shape via the toolbar overlay also forwards double-click through the same controller with canvas-local coordinates. Existing node/edge/title editing, space-pan, viewer protection and the configured empty-space double-click action remain intact. Empty freehand clicks with less than two screen pixels of jitter no longer create stray strokes or short-stroke warnings. Tests cover the three mode handlers, coordinate conversion, left-button gating, jitter suppression and existing drawing/tool behavior. Native UI verification and packaging are pending.

## Cut nodes with Ctrl+X

Added the editable cut shortcut in the basic keybind group (Ctrl+X). Cut uses the existing node clipboard format, including internal edges, container descendants and attachments; Ctrl+V retains cursor-centered placement in the same or another document. Clipboard write must succeed before deletion. The original objects are captured before awaiting the write, so later selection changes cannot redirect deletion; changed or removed content cancels deletion. Locked/background content and viewer mode are protected. Descendants are deleted with the container in one source history step; paste has its own target history step. Existing text-input shortcut protection stays in place. Tests cover same/cross-document cut/paste, cursor center, undo, expanded container contents, failed writes, selection races and edits during copying. Source only; no packaging/install/native acceptance.

## Optional automatic container expansion

Settings > Control > Section > Automatically expand containers (containerAutoExpand, default false) switches bounded doodles from clamping contents to growing around them during adoption, generation, content resizing and movement. Rectangle frames grow only on necessary sides; circular frames retain their center and increase radius. Nested fixed containers propagate expansion outward. Decorative doodles are unaffected; no automatic shrink occurs. Existing fixed-boundary behavior remains available by disabling the setting. Tests cover edge creation for both shapes without node displacement, three-level propagation, ordinary nested movement, fixed-mode restoration, history, and settings persistence. Source only; no installed-app or native UI verification.

## Nested fixed containers

Drawing a bounded frame inside another now adopts it into the smallest enclosing fixed container and transfers fully enclosed sibling nodes/groups into the inner frame. Adoption removes the old parent's child reference; cycle checks replace the blanket rejection of nested fixed containers. Existing movement traverses the resulting hierarchy once. Tests use real PG containers/nodes and verify inner/outer translation, untouched siblings, outer-boundary clamping, undo/redo and MsgPack reload. Decorative frames remain non-capturing. Existing files are not automatically reinterpreted by geometric overlap; an old empty frame can recapture through switching its container mode off/on. Source only, not packaged or installed; native interaction acceptance is pending.

## AI panel shortcut toggle

The existing openAIPanel command (default A+I, saved custom bindings retained) now toggles the AI panel. Open panels, including docked/floating instances created from other entry points, close through the same TabWorkspace.close path as the panel close button. Closed/closing instances are ignored so the next press opens again. Text input/IME shortcut protection remains unchanged. No settings files or installed binaries were changed; native UI acceptance is pending.

## Sound feedback latency

Configured effect files are preloaded and decoded when the service starts and when paths change or sound is enabled. Concurrent requests share one pending decode; cached effects start synchronously while the audio context is running. Suspended audio resumes on keyboard/pointer interaction and before playback. Effects delayed more than 150 ms by loading/resume are discarded rather than replayed late; their decoded buffers remain ready for subsequent actions. Existing volume, pitch, effect paths and enabled settings are unchanged. Completed sources disconnect from the gain node.

Six focused tests cover volume, disabling/empty paths, preload deduplication, synchronous warm playback, stale feedback suppression and suspended-context recovery. Actual speaker/device latency and any leading silence inside user audio files have not been measured. This is a source-only change, not an update to the installed application.

## One-shot growth edge rules

Tab+R arms the selected node's next deep-growth edge to point from the new child back to that node; Tab+G arms an arrowless MultiTargetUndirectedEdge. These commands are editable in the tree-growth shortcut group. The user's existing NN binding is not changed. The rule is held in the project engine, not settings or the project file, and is consumed after a successful new-node connection. Other roots and breadth growth do not consume it. A later mode replaces the pending mode. Armed growth bypasses the existing-node probe so the operation creates the requested next node. Existing edges are untouched.

Special growth uses the usual geometry/layout first, then adjusts only the newly created edge and records the final result in one undo step. Undo does not re-arm the one-shot rule. Tab chords are suppressed in text inputs and shortcut recording; plain Tab bindings still execute on release when a Tab chord is eligible, including sequences ending in Tab. Tests cover one-shot direction, no-arrow conversion, source-node isolation, last-mode-wins, undo/redo, normal subsequent growth, keyboard chord handling, focus loss and existing E-then-Tab sequences. Source only; no installer or native acceptance in this change.

## Drawing toolbar docking and experimental cross-file links (2026-11-03)

The drawing toolbar and its commands now require mouseLeftMode=draw. The old bottom mouse-mode switch UI is no longer mounted; saved key bindings are unchanged. The grip docks the drawing toolbar to the top/bottom (horizontal) or left/right (vertical) of its own canvas. A drag previews the destination and persists drawingToolbarPosition only on release; cancellation restores the previous position. Default is bottom. Parameters open toward the canvas interior.

Settings > Visual > Experimental > Cross-file node connections enables the new independent overlay (off by default). Use the upper-right Cross-file connection button, then drag from a node in one saved local file to a node in another, or click the two endpoints. The list locates endpoints and removes links. Split-right, split-down and same-app floating tabs share screen-coordinate conversion; an obscured/offscreen endpoint hides its connecting line. This is separate from the drawing toolbar and ordinary in-file edges.

Each outgoing link is an optional crossFileLinks field on its source ConnectableEntity, storing a target file URI and node UUID. Existing node constructors accept the optional field; ordinary nodes without links remain compatible. This uses the existing stage serialization, source-file save/dirty tracking and undo/redo. The target document is not mutated. Disabled mode retains records. Deleting the source removes its links; missing or closed targets leave a visible unresolved status in the list. Reopening the same target resolves by URI and UUID, never by matching text or filename alone.

Limits: local saved files in the same app window only; no links between separate Windows processes. Target file rename/move requires recreation of the link. No background scan of closed files or automatic repair. Cross-file lines are an interactive workspace overlay, not included in single-canvas exports, layout algorithms or existing graph traversal. Older PG versions can open the ordinary nodes but may drop the new optional link field when saving; keep linked files in PG1.4. This work did not build, install, change user settings files, or perform native desktop acceptance.

Validation includes real TextNode/ConnectPoint serialization, binary round-trip, source-only mutation, undo/redo, duplicate/draft/disabled/read-only/locked checks, missing-target preservation, React cross-canvas pointer events, screen scaling and floating-overlay occlusion. Toolbar tests cover four dock destinations, cancelled drag, mode gating and settings persistence. These automated checks do not substitute for native UI acceptance.

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

## Keep node text when zoomed out

Settings > Performance > Rendering includes `alwaysRenderNodeText`, enabled by default for old and new profiles. Text-node labels and URL titles/addresses no longer disappear at the existing screen-font-size threshold. Their size still follows canvas scale; node geometry, wrap width and content remain unchanged. The previous threshold value is preserved and takes effect again when this new option is disabled. The transparent-node fallback fill is also skipped when text remains visible. Existing collapse, section visibility and details controls remain unchanged.

When integer text alignment is enabled, subpixel text bypasses integer rounding to avoid rounding font size to zero or distorting wrap width. The stored alignment setting is not modified; text of at least one screen pixel retains the previous rounding behavior.

Validation: 15 renderer/settings tests and 52 copy/keyboard/sound regression tests passed. The actual node renderers were exercised at scales 1, 0.26, 0.25, 0.1, 0.01 and 0.001, including the old cutoff boundary. At scale 0.001 the shared text renderer reaches canvas fillText for multiline labels, URL titles and addresses with integer alignment both on and off. Canvas calls use a test drawing context, not an actual Windows screenshot or GPU. Type checking and ESLint passed; no build or installation performed. Many visible labels may increase rendering cost, and very small text naturally becomes difficult to read.

## Ordinary text-node collision with auto-alignment

On 2026-11-03, the running executable was Project Graph PG1.3. A read-only same-user background probe of its effective profile confirmed `isEnableEntityCollision=true`, `isEnableSectionCollision=true`, and `enableDragAutoAlign=true`. The direct Codex filesystem view showed an older profile copy, so it was not used as evidence of the running app's settings. Only collision/alignment-related values and file metadata were emitted; no API credentials were printed. The probe is retained under outputs/PG1.4-collision-20261103. No user settings or shortcuts were changed.

Four pre-fix regressions were reproduced with real TextNode/StageManager objects: exact-center dragging caused a zero-distance recursive stack overflow; moveTo skipped collision checks; auto-sized text growth skipped collision checks; auto-alignment did not recover the overlapping state. The fix uses actual edge separation distances (including full containment) with a deterministic direction at equal centers, checks text-node absolute moves and size changes, and resolves a newly inserted text node after its references are established. Detached constructors and clipboard deserialization do not push live nodes. Batch insertion with skipUpdateReferences=true retains its existing behavior for validated layouts. Fixed-container collision exclusions remain unchanged.

Only three production source files changed: StageEntity.tsx (separation vector), TextNode.tsx (missing geometry-change entry points), StageManager.tsx (ordinary text insertion). No auto-alignment math, settings schema, shortcut, file format or section solver was changed.

Validation: 137 tests passed in 10 files, including 13 collision/alignment cases, Doodle containers, AI tree operations, smart tree arrangement, max-width text, copy/paste, keyboard shortcuts, settings and zoomed text. Specific checks include snapping X/Y to different neighbors, full containment, a 30-node collision chain, manual sizing, disabled collision, detached construction, undo/redo and MsgPack geometry restoration. Type checking and ESLint passed. No native desktop acceptance, build or installation was performed. This is not a replacement of the general recursive collision engine; arbitrary very large or immovable/fixed-boundary arrangements and repair of all pre-existing overlaps on file open are not claimed. Batch clipboard layout was regression-tested but its placement policy was not changed.
