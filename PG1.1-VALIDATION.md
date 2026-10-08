# PG1.1 验证记录（未完成交付）

更新：2026-10-08。本文件区分源码审查、自动测试和实际运行验证，不能作为 PG1.1 已完成的声明。

## 基线与保护

- PG1.0：分支 `custom/max-text-width`，固定提交 `39e3fd17da43e56575f7aa25e800dda1f3e3f62f`。本次复查远端引用仍指向该提交。
- PG1.1：独立分支 `pg1.1-chatgpt-signin`。当前应用源码与构建 #7 相同；后续提交补充回归测试工作流。
- 本地解压目录没有完整 Git 提交历史，并包含已暂存及未提交文件；没有重置、清理或覆盖这些文件。远端固定提交用于对照，不能把本地状态视为干净检出。

## 文件变更及原因

| 文件 | 类型 | 用途 |
| --- | --- | --- |
| app/src-tauri/src/chatgpt_auth.rs | 新增 | 官方授权、令牌保护、模型目录、套餐请求与流转换 |
| app/src/core/service/dataManageService/aiEngine/ChatGPTPlanFetch.ts | 新增 | 前端向 Rust 转交套餐请求与流式结果 |
| app/src/sub/SettingsWindow/ChatGPTConnectionSettings.tsx | 新增 | 登录状态、模型选择、连接/断开和额度说明 |
| app/src-tauri/Cargo.toml | 修改 | 新认证模块所需依赖 |
| app/src-tauri/src/lib.rs | 修改 | 注册认证状态与命令 |
| app/src-tauri/tauri.conf.json | 修改 | PG1.1 名称、版本及窗口标题 |
| app/src/core/service/Settings.tsx | 修改 | 可选连接模式和 ChatGPT 模型设置，默认 API |
| app/src/core/service/dataManageService/aiEngine/AIEngine.tsx | 修改 | 根据连接模式分流，保留原 API 分支 |
| app/src/sub/SettingsWindow/settings.tsx | 修改 | 添加连接方式及登录设置入口 |
| app/src/sub/AIWindow.tsx | 修改 | 套餐使用提示与管理链接 |
| app/src/locales/en.yml、zh_CN.yml | 修改 | 新连接模式所需文案 |
| .github/workflows/custom-windows.yml | 修改 | 类型检查、认证测试、全量前端测试、基线对照及 Windows 打包 |
| PG1.1.md、PG1.1-VALIDATION.md | 新增 | 使用说明与交付验证记录 |

## 已取得的证据

- [构建 #7](https://github.com/eingustaf07/project-graph/actions/runs/37672414776)：类型检查、3 个认证单元测试、选定回归测试、语言同步及 NSIS 安装包构建通过。这不证明 GUI 或真实账号授权通过。
- [全量测试 #8](https://github.com/eingustaf07/project-graph/actions/runs/37715541304)：293 通过、42 失败、3 跳过；测试准备缺少本地 ownership helper。
- [修正准备后的 #9](https://github.com/eingustaf07/project-graph/actions/runs/37730588940)：300 通过、35 失败、3 跳过，另有 8 个测试运行错误；48 个测试文件通过、3 个失败。辅助程序构建、类型检查和认证单元测试通过。
- #9 剩余失败涉及 ProjectGraphCli、ProjectGraphCliProduction、OpenProjectRuntimeHost。日志含 Windows 上调用 /usr/bin/lockf 及进程启动失败。尚未取得基线对照结果，不能断言全部是旧缺陷。
- [对照测试 #10](https://github.com/eingustaf07/project-graph/actions/runs/37732673849)：分别检出 PG1.0 固定提交与 PG1.1，在 Windows 上运行相同全量前端测试。启动已确认，结果待收集。
- 当前没有把失败测试移除、跳过或改为通过；失败的全量测试阻止对应安装包构建。

## 用户要求的回归覆盖

| 要求 | 当前证据与缺口 |
| --- | --- |
| 1–7：旧项目、节点、连线、保存/重开、已有 UI | 源码差异未涉及这些模块；有自动测试通过，但未逐项完成安装版 GUI 验证 |
| 8–15：原 API、API Key、Gemini、DeepSeek、聊天、流、上下文、MCP | 原 API 分支保留；多个 AI 测试通过。真实服务连接、流式聊天和 MCP 实际调用尚未验证 |
| 16：ChatGPT 未登录 | 界面及状态代码已实现；安装版实际显示尚未验证 |
| 17–19：官方登录、失败隔离、登录后请求 | 官方协议实现已加入；用户账号授权和真实请求尚未端到端验证 |
| 20–22：断开、重启、过期再授权 | 代码路径已实现；完整生命周期实际验证待完成 |
| 23–24：Token/Secret | 源码使用 Windows DPAPI 保护凭证；仍须完成对最终代码、日志、安装版运行的完整安全复查 |
| 25：原设置不被破坏 | 默认 API 设置兼容，但两版共用数据目录存在隔离风险，见下文 |

## 登录、分流和认证存储

代码按官方开源应用流程注册客户端，使用 state、nonce、PKCE 和本地回调。浏览器完成用户授权后，原生模块处理凭证；前端只得到连接状态与允许的模型信息。真实授权结果尚未验证。

自定义 API 模式继续使用原 API 地址、Key 和模型。ChatGPT 模式经独立转交模块进入原生认证模块，再调用官方允许的 Responses 通道。未支持的输入/工具应明确报错，不得隐式使用用户 API Key。

新凭证写入应用数据目录内的 `chatgpt-auth.dpapi`，由 Windows 当前用户 DPAPI 加密。不得把凭证内容写入项目、Git、界面或日志。现有 API Key 的保存方式沿用 PG1.0。

当前实现采用官方动态客户端注册；尚无经过真实账号授权验证的成功结论。部署或账号侧是否出现额外权限限制，应以官方响应为准，不伪造参数。

参考：[官方注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[官方界面要求](https://developers.openai.com/siwc/ui-ux-guidelines)。

## 尚未解决的交付事项

1. 完成 PG1.0 / PG1.1 对照，修复所有已证明的新回归。
2. 两版目前共用 `eingustaf07.project-graph-custom` 数据标识。虽然 NSIS 产品名称不同，仍须处理设置共享写入及卸载清理可能影响旧版的问题；不能只靠名称区分声称完全隔离。
3. 保留用户 API、快捷键和其他自定义设置，同时完成必要的版本隔离验证。
4. 完成正常安装/启动/退出、窗口数量、无额外空白窗口、无控制台依赖验证。没有以临时诊断实例的成功代替普通启动验证。
5. 完成真实 ChatGPT 登录、请求、断开、重启和过期恢复测试。
6. 核对最终安装包对应的源码提交，并提供可下载的 .exe 与安装步骤。

当前实现范围不含 OpenAI 托管 MCP/connectors、文件搜索、Code Interpreter、音视频及文件上传；不据此改动原 API 模式已有能力。未自动开启额外付费 Credits。

## 回到 PG1.0

稳定源码仍在上述固定提交和分支。用户现有 PG1.0 安装不应卸载或覆盖。PG1.1 完成隔离前，不推荐把候选安装包用于替换现有版本。仅在 PG1.1 内切回“自定义API”可切回旧请求路径，但不等于安装/数据层面的完整回滚。
