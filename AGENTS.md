## Project Background

Github Repository: `graphif/project-graph`

Project Graph 是一款桌面级节点图绘制工具，用于头脑风暴、知识图谱、项目规划等场景的可视化思考。

## Tech-stack

- React (TypeScript) + Tauri (Rust)
- Vite + pnpm (monorepo) + Nx
- Canvas 2D
- shadcn/ui + Tailwind CSS + 自研子窗口系统
- Jotai

Rust 主要负责本地文件等系统能力；绝大部分业务逻辑在前端。

## Structure

### Application

- Frontend Vite project: `/app`
- Rust / Tauri: `/app/src-tauri`
- UI components: `/app/src/components`
- i18n locales: `/app/src/locales`
- React state (Jotai 等): `/app/src/state.tsx` 及附近

### `app/src/core`（核心业务）

| 路径                              | 职责                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `Project.tsx`                     | 单个工程/项目实例的入口与生命周期                                               |
| `Tab*.ts(x)` / `TabWorkspace.tsx` | 标签页与工作区                                                                  |
| `loadAllServices.tsx`             | 注册/加载全部服务                                                               |
| `algorithm/`                      | 通用算法与几何工具                                                              |
| `stage/`                          | 舞台：`Camera`、`Canvas`、舞台对象（`stageObject`）、舞台管理（`stageManager`） |
| `render/`                         | 渲染：`canvas2d`、`svg`、`3d`、`domElement`                                     |
| `service/`                        | 业务服务（见下）                                                                |
| `extension/`                      | 扩展系统运行时与 API                                                            |
| `fileSystemProvider/`             | 文件系统抽象（草稿/本地文件等）                                                 |
| `interfaces/`                     | 核心接口（如 `Service`）                                                        |
| `subWindowOpen*.ts`               | 子窗口打开方式                                                                  |

`service/` 主要子目录：

- `controlService/` — 输入控制、快捷键、框选、自动布局等
- `dataFileService/` — 工程文件读写
- `dataGenerateService/` — 数据生成
- `dataManageService/` — 内容搜索、复制、AI、节点工具等
- `feedbackService/` — 特效、音效、舞台样式、颜色
- `Settings.tsx` 等 — 设置、主题、菜单、教程等全局服务

### Packages（`/packages`）

前端复用的开源/内部库，例如：

- `@graphif/serializer` — 实例序列化
- `@graphif/shapes` — 可序列化图形
- `@graphif/data-structures` — 可序列化数据结构
- `extprg` / `extprg-types` / `create-extprg` — 扩展工具链与类型

### Agent skills

具体工作流见 `.agents/skills/`：

- `type-check` — TypeScript 类型检查（**改代码后用这个，不要 build**）
- `create-keybind` — 新增/修改快捷键
- `create-setting-item` — 新增/修改设置项
- `shadcn` / `ui` — UI 组件
- `suggest-lucide-icons` — 图标建议

## Locales (`app/src/locales`)

| 文件         | 说明                                                               |
| ------------ | ------------------------------------------------------------------ |
| `en.yml`     | 英文（手写维护）                                                   |
| `zh_CN.yml`  | 简体中文（手写维护）                                               |
| `zh_TW.yml`  | 普通繁体中文 — **由 `zh_CN.yml` 自动生成（OpenCC）**，**不要手改** |
| `zh_TWC.yml` | 接地气繁体中文 — **手写维护，不是自动生成**                        |
| `id.yml`     | 印尼语（手写维护）                                                 |

新增文案时：改 `en.yml` / `zh_CN.yml`（及需要时的 `zh_TWC.yml`、`id.yml`），**不要编辑 `zh_TW.yml`**。

## Coding guidelines

- 正确性与清晰度优先；性能除非明确要求，否则次之。
- 不要写组织性/总结性注释；仅在「为什么这样写」不直观时解释 why。
- 优先在已有文件中实现功能；仅在新的逻辑组件时新建文件，避免拆成大量小文件。
- 目录内使用 `something.tsx`，不要用单独的 `index.tsx`。
- 错误处理（**前端**）：
  - 不要静默吞掉错误：禁止 `catch {}` 或仅 `console.error` 后忽略
  - 能不 catch 就不 catch，让调用方处理
  - 需要忽略时用对话框提示用户（用户看不到控制台）
  - 错误应向上传到 DOM（如 `window`），由 `ErrorHandler` 展示友好对话框
  - 反例：`try { something() } catch (e) { console.error(e) }` → 直接 `something()`
- 错误处理（**Rust / Tauri 命令**）：命令在运行中不能让进程因未捕获错误闪退，须在函数内妥善处理错误并返回给前端。
- UI：优先复用 shadcn 与 `.agents/skills/ui` 中的约定（`Dialog`、`toast` 等）。
- 快捷键 / 设置：分别遵循 `create-keybind`、`create-setting-item` skill。

## Commands

包管理：`pnpm`。常用：

- 开发：`pnpm dev`
- Lint：`pnpm lint` / `pnpm lint:fix`
- 测试：`pnpm test`（vitest）
- 类型检查：**使用 `type-check` skill**（`pnpm --filter @graphif/project-graph type-check`）

**禁止** Agent 运行 `build` / `build:ci` / `build:no-tauri` / `tauri build` 等构建命令。验证改动用 type-check（及必要的 lint/test），不要 build。

## Agent constraints

- **依赖 API / 用法**：禁止用 shell 在 `node_modules` 里搜索、翻源码或类型定义。需要了解第三方库时，读取该项目的官方文档（优先 `llms.txt`，例如 `https://<pkg-docs>/llms.txt`），或使用已有 skill；不要 `grep` / `find` / `cat` `node_modules/**`。
- **实现方式**：禁止用 `python`、`python3`、`node -e`、`node --eval`、内联 shell 脚本等做文本处理或批量改文件。应直接用读/写/编辑文件的工具（Read / Write / Edit 等）完成；需要多文件改动时逐个编辑，不要写临时脚本。
- **构建**：禁止 build（见上）；验证用 type-check skill。

## Commit Message

- User-required release record: every new feature and every bug fix must add a separate, user-readable entry under the current version in `app/src/sub/SettingsWindow/about.tsx` before delivery. Include the affected behavior and the entry point when applicable. Keep previous version entries. Record verification limits accurately. Code, tests, current-version log and deployment status must agree.

使用 [Conventional Commits](https://www.conventionalcommits.org/)，例如：`feat: ...`、`fix: ...`、`refactor: ...`。

## Windows upgrades and launchers

- Regression #1 (Windows daily developer profile): compare the effective command IDs, assigned keys, enabled states, and loaded extensions in the Explorer/normal-launch main and detached windows against the user's known-good configuration. An equal runtime count, source fingerprint or reported Roaming path can conceal different physical profile contents. Confirm Ctrl+H opens Find and locked HH follows the selection. This user's provisioned settings, bindings, colors, quick settings and extensions live under the Windows home directory in .project-graph-e/preferences. Preserve that directory across deployments.

- Deployment from `../PG1.1-ai-tree-auth-persistence`, branch `e15-auth-persistence`, completed on 2026-11-09 after authorization. Product name is `Project Graph E 1.5`. Windows compilation and credential tests passed; real canvas/About naming, encrypted credential migration and connected account status across native restart were verified. Native .prg association, shared shortcut and launcher registry point to the current physical EXE. Settings and shortcuts are semantically unchanged. See `C:/Users/gustaf/Documents/PG-E15-Deployment-20261109`; actual key injection and visual taskbar grouping were not tested.
- Product names from now on follow `Project Graph E <version>`, including the space between E and the version. Preserve the existing app identifier, executable basename and settings storage identity when changing product names.

- The large-file tab switching and zoomed-out CC bulk-cutting fixes from `../PG1.1-ai-tree-tab-switch` were authorized and deployed on 2026-11-09 together with the current-version log entries. This work is no longer pending source deployment. Real-project desktop responsiveness remains a separate acceptance check.

- The user authorized deploying the two fixes from `../PG1.1-ai-tree-large-tree-drag` on 2026-11-09. Both are applied to this daily checkout and acknowledged by the developer runtime. Tests and type-check passed. Live pointer acceptance remains incomplete because the Windows automation helper reported a 15x15 target and then no screenshot target. Do not describe desktop drag/resize acceptance as completed.

- The user's daily PG is the live-source Windows development version from this checkout. Keep pending changes in a separate worktree until the user explicitly asks to package them. Packaging updates the existing developer application by default. After the user requests packaging and the checks pass, POST to `http://localhost:1420/__pg_development/apply` and verify `/__pg_development/status` has a newer `readyAt`. This applies the checked source and restores the open project buffers, history and viewport. Report any recovery failure and fix it before handing off.
- Start the development desktop through `%LOCALAPPDATA%\Project Graph Development\project-graph-pg11.exe`. It starts its own local Vite server and uses the existing profile. For native Rust changes, rebuild the development shell through `Windows development shell`, update the executable after safely closing it, and verify startup before updating Windows entry points.
- Store the bundled Node runtime path in `development.json` relative to the executable directory (for example `runtime\node-v26.13.0-win-x64\node.exe`). The development launcher resolves it from its own directory and recovers legacy stale absolute paths using the matching bundled version. Validate startup from a normal Windows process with no server already running; a working server can conceal a broken runtime path. Run `scripts/start-pg-development-server.Tests.ps1` after changing launcher paths.
- Deploy `scripts/set-pg-development-icon.ps1` beside the development executable together with `app/src-tauri/icons/icon.ico`. The development server launcher starts this helper to set the window icons. Development shortcuts must use this ICO as their IconLocation.

- Preserve `mainBinaryName` and `identifier` across custom PG upgrades. Keep `productName`, version, and the native window title consistent with the release.
- Keep the NSIS current-entry postinstall hook enabled. It updates `HKCU\Software\ProjectGraphCustom\CurrentExecutable` / `DisplayName`, the canonical `ProjectGraph.Current.File` association, and existing PG taskbar shortcuts. Do not replace this with version-specific launch paths.
- The user's Alt/Win + numpad 4 launcher resolves the shared Start menu shortcut `Project Graph (Current).lnk` on each press and matches the full executable path. A registry value visible inside Codex may be absent in the launcher's native Windows session. Verify from the scheduled task's context. Preserve both bindings and other application mappings.
- For every PG change or version update, completion includes checking that Alt/Win + numpad 4 targets the latest daily PG. Register the physical executable path seen by native Windows processes, including Codex package redirection. Verify the running launcher uses this path and cannot fall back to an older PG. Record any unverified keyboard acceptance explicitly.
- Highest-priority user requirement for this project: every PG deployment or version upgrade must update the default handler for all `.prg` files to the latest daily PG before completion. Register with `app/src-tauri/nsis/pg-current-entry.ps1` from an ordinary Windows process (a temporary interactive-user scheduled task can do this). Verify native `AssocQueryString` for `.prg` resolves to the physical executable targeted by `Project Graph (Current).lnk`. Codex's packaged registry view alone is insufficient. Refresh shell association caches and preserve user projects/settings.
- Before releasing a Windows upgrade, run `pg-current-entry.Tests.ps1` and `pg11-import-profile.Tests.ps1` in `app/src-tauri/nsis`. Then verify the installed executable, file association, pinned name/icon, and actual shortcut activation; script checks alone do not prove visual taskbar grouping.
- Do not change project files, profile directories, shortcuts inside PG, or existing settings to repair Windows entry points. Do not alter protected Windows UserChoice hashes.
- For every future PG change and deployment, compare the real main window and a real child opened via the normal new-window action. Verify code revision, registered native and extension commands, saved shortcut mappings, and representative old and new behaviors. Equal executable paths or version labels alone do not establish correctness. Keep original functions and user settings; investigate shared dispatch/loading regressions rather than reimplementing missing features. A child must not acknowledge success before its extension registrations and runtime compatibility checks finish.
- E 2.1 Windows acceptance on 2026-11-11 used the actual tab context menu, verified the child owned the transferred file, and exercised keyboard events in both windows. Alt+Q split an arc, Backspace preserved sibling connections, Shift+C selected four highlighted nodes, and Ctrl+G followed by Escape and Ctrl+H allowed /空 search. Compare the ordinary Windows user's live bindings with the daily profile. The Codex package-local copy has different historical values. Do not copy it over the user's settings. Evidence: C:/Users/gustaf/Documents/PG-E21-NewWindow-20261111/normal-features-all.json.
- On 2026-11-11, the user explicitly authorized deploying all pending E 2.1 changes. Source through `6149a00` was applied to the daily `PG1.1-ai-tree` checkout after checking the exact E 2.0 baseline. Windows development shell run `43016435445` passed; the installed executable is Project Graph E 2.1 / 2.1.0, SHA256 `A4FF9EBDDFD7B45B8B475036A1F6EECBACE7A9DE4FA0B6C72AA84E1897D32D69`, with the same identifier, executable path and profile identity. All 150 targeted tests, type-check, launcher-path and NSIS entry/profile tests passed. Native canvas and connected ChatGPT account were observed; two running windows resolve to the current executable. Native .prg resolution, Current shortcut and both running Alt/Win numpad 4 mappings were verified; physical key injection and a full live shortcut acceptance pass were not completed. Existing settings and shortcut values compare unchanged, with new command entries added. Temporary deployment-session edits were restored exactly. Evidence and rollback backup: `C:/Users/gustaf/Documents/PG-E21-Deployment-20261111`. These E 2.1 changes are deployed, not pending; do not reapply them over subsequent edits.
