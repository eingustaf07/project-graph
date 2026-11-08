import logoUrl from "@/assets/icon.png";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function AboutTab() {
  const [appVersion, setAppVersion] = useState("unknown");
  const [logoClickCount, setLogoClickCount] = useState(0);
  const { t } = useTranslation("welcome");

  useEffect(() => {
    (async () => {
      setAppVersion(await getVersion());
    })();
  }, []);
  useEffect(() => {
    (async () => {
      if (logoClickCount >= 10) {
        const url = await Dialog.input("navigate", navigator.userAgent, { destructive: true });
        if (url && url.length > 5) {
          window.location.href = url;
        }
        setLogoClickCount(0);
      }
    })();
  }, [logoClickCount]);

  return (
    <div className="text-foreground mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto px-6 py-8">
      <img src={logoUrl} alt="Project Graph Logo" className="absolute inset-0 -z-10 size-full blur-[150px]" />
      <img
        src={logoUrl}
        alt="Project Graph Logo"
        className="mx-auto size-32 shrink-0"
        onClick={() => setLogoClickCount((it) => it + 1)}
      />

      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-semibold">
            <span>Project Graph Custom</span>
            {/* 把版本号调大一些，因为一些用户录屏反馈的时候会主动打开这个页面，展示版本号。如果字太小了，在手机上看用户录屏视频就看不清了 */}
            <a
              href="https://graphif.dev/docs/app/misc/history"
              target="_blank"
              rel="noopener noreferrer"
              className="border-border bg-muted inline-flex cursor-pointer items-center rounded-md border px-2 py-1 text-xl hover:underline"
            >
              v{appVersion}
            </a>
          </h1>
          <p className="text-sm opacity-50">{t("slogan")}</p>
        </div>
      </header>

      <section className="text-sm leading-6">
        <p>这是你的自定义版本。官方版可独立保留；本版本不会自动下载安装更新。</p>
        <p>查看官方新版本后，你可以继续使用当前版本，或将官方改动合并到自定义仓库并重新构建，保留最大宽度功能。</p>
        <div className="my-3 flex flex-wrap gap-2">
          <Button onClick={() => open("https://github.com/graphif/project-graph/releases")}>
            查看官方新版本（手动选择）
          </Button>
          <Button variant="outline" onClick={() => open("https://github.com/eingustaf07/project-graph/releases")}>
            查看自定义版安装包
          </Button>
        </div>
        <p>
          Project Graph 是一个图形化思维桌面工具和知识管理系统，支持节点连接、图形渲染和自动布局等功能， 基于 Tauri +
          React 技术栈构建。它旨在提供一个高效、直观的方式来组织和管理个人知识。
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div className="rounded-md border p-4">
          <div className="text-xs opacity-50">开发者</div>
          <div className="mt-1 font-medium">
            <Author name="Littlefean(阿岳)" url="https://github.com/Littlefean" />,{" "}
            <Author name="zty012" url="https://github.com/zty012" />,{" "}
            <Author name="Rutubet(小劫)" url="https://github.com/Rutubet" /> 以及所有贡献者
          </div>
        </div>
        <div className="cursor-pointer rounded-md border p-4 **:cursor-pointer">
          <div className="text-xs opacity-50">官网与仓库</div>
          <div className="mt-1 font-medium underline underline-offset-4" onClick={() => open("https://graphif.dev/")}>
            graphif.dev
          </div>
          <div
            className="mt-1 font-medium underline underline-offset-4"
            onClick={() => open("https://github.com/graphif/project-graph")}
          >
            graphif/project-graph
          </div>
        </div>
      </section>

      <section className="rounded-md border p-4 text-sm leading-6">
        <h2 className="mb-2 text-lg font-semibold">自定义版更新日志</h2>
        <p className="mb-3 text-xs opacity-60">
          按累计版本记录，每版继承此前功能。快捷键以你的实际设置为准，可在“设置 → 快捷键”中修改。
        </p>
        {versionHistory.map((release, index) => (
          <details key={release.version} open={index === 0} className="border-t py-3">
            <summary className="cursor-pointer font-semibold">
              {release.version} · {release.title}
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {release.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </details>
        ))}
      </section>

      <footer className="text-xs opacity-50">{/**/}</footer>
    </div>
  );
}

const versionHistory = [
  {
    version: "PG1.5",
    title: "布局、缩放控制与开发版",
    changes: [
      "实验性网格对齐：开启背景方格后，新生成节点以最近的任意角点对齐网格交点；兼顾树形层级与碰撞间距。在设置中搜索“网格”。",
      "图片自由缩放：选中图片后使用四角和四边中点，共八个控制点，分别调整宽度和高度。",
      "容器和几何涂鸦框增加四个边中点，支持八个控制点调整大小。",
      "选中有向连线时，Tab+R 立即反转箭头，Tab+G 转为无向连线。选中单个节点时，这两个快捷键仅影响下一次 NN 生长。",
      "容器进出键改为 K。开启容器边界后，先选中节点，再按住 K 拖入或拖出；普通拖动和松手对齐都会停在边界。",
      "修复打开工程和最近文件时未切换到对应画布，以及开发版页面重载后重复打开工程可能一直等待的问题。",
      "修复特定曲线连接结构中 NN / TT 生长与自动布局异常。",
      "改进普通文字节点在生成、移动时的碰撞分离，使用非递归推移处理，避免递归爆栈。",
      "减少首次按住右键拖动画布时重复计算全图文字尺寸造成的卡顿。",
      "改善大图持续平移和滚轮缩放的流畅度：跳过已经错过的画面，减少隐藏命令面板、文字和局部擦除涂鸦的重复绘制开销。",
      "统一当前版本的 Windows 启动入口、热键目标与文件关联。",
      "日常开发版支持加载当前源码，并在检查后应用更新、恢复工程缓冲区、撤销历史与视角；底层程序修改仍需编译和重启。",
      "修复开发环境启动时的空白画布及开发版窗口、任务栏图标。",
    ],
  },
  {
    version: "PG1.4",
    title: "操作、音效与容器增强",
    changes: [
      "Ctrl+C 复制节点，按住 Ctrl 连按两次 C 复制文本；Ctrl+X 剪切后可跨文档在鼠标位置粘贴。入口为设置 → 快捷键 → 基础。",
      "设置 → 个性化 → 音效：增加 0–100% 音量滑动条和每项音效独立开关。",
      "双击新建节点、创建涂鸦或容器、快捷键删除增加音效；预加载和缓存音效以减少延迟。",
      "绘图工具栏仅在 BB 画笔模式生效，默认位于底部，可拖动把手停靠上、下、左、右；移除旧鼠标模式切换栏。",
      "实验性跨文件节点连接：在设置 → 视觉 → 实验性功能开启，通过画布右上方入口连接同一窗口内已保存的本地文件节点，支持拆分和应用内浮动。",
      "A+I 改为打开或关闭 AI 面板；ZZ、BB、CC 模式均可按既有双击设置在空白处创建节点。",
      "容器支持嵌套收纳与整体移动；可在设置 → 控制 → 分组框开启自动扩张、按 N 拖入或移出。",
      "增加下一次 NN 连线方向的一次性设置，后续 PG1.5 修复其触发问题。",
      "修复容器命名后调整大小、涂鸦重复改名、缩放时容器标题消失及连续右键连线误判自环。",
      "增加缩小时保留节点文字的设置；修复普通文字节点碰撞与自动对齐共同使用时的重叠。",
      "修复鸣谢名单、扩展市场 undefined 地址及 PG 账户入口缺少云服务地址的问题。",
      "修复包含双向弧线时 NN 生长递归卡顿，并保护新节点自动进入编辑模式。",
    ],
  },
  {
    version: "PG1.3 / 1.3.1",
    title: "剪贴板与绘图",
    changes: [
      "增加节点与文本两种复制方式，粘贴节点或节点树时将其中心放到鼠标位置，支持同文件和跨文件。",
      "增加文档拆分后的合并入口，恢复在同一组标签中查看多个文件。",
      "修复截图、剪贴板图像和复制的图片文件粘贴，图片作为画布实体继续操作。",
      "空白画布 Ctrl+滚轮以鼠标位置为中心缩放。",
      "增加几何涂鸦和固定边界容器，支持直线、矩形、圆形及颜色设置。",
      "增加大小可调的橡皮：涂鸦与图片局部擦除，节点整块删除。",
      "紧凑绘图工具栏支持容器和涂鸦模式；边框可重新选择、拖动、调整大小，点击外部结束边界编辑。",
      "双击边框编辑或清空标题，默认无标题；修复旧图形无法重新选择的问题。",
      "可配置绘图快捷键：ER 橡皮、KK 容器、SQ 矩形、CY 圆形、ST 直线；A+I 唤起 AI 面板。",
      "1.3.1 修复正式打包中涂鸦类初始化顺序造成的启动失败。",
    ],
  },
  {
    version: "PG1.2",
    title: "AI 树生成与整理",
    changes: [
      "AI 树生成按真实节点尺寸计算布局，增加最大宽度、避免覆盖和内容结构保护。",
      "增加文字查找与替换、批量替换及撤销。",
      "增加关联节点高亮，可在设置中选择直接相连或间接相连；默认关联高亮操作为 Tab+G。",
      "实验性智能规整树形布局：设置 → 视觉 → 实验性功能开启。选中节点后使用 Ctrl+Alt+L 或右键菜单。",
      "布局可保留原方向或统一向右、左、上、下，层级、同级和子树间距可调，支持撤销。",
      "不安全的环路、多父节点等结构会提示拒绝布局，保留连接关系。",
    ],
  },
  {
    version: "PG1.1",
    title: "ChatGPT 账号连接",
    changes: [
      "设置 → AI 增加 ChatGPT 账号与自定义 API 两种连接方式，提供登录、连接状态和断开入口。",
      "通过官方浏览器授权流程连接 ChatGPT，Windows 认证信息使用当前用户的 DPAPI 加密保存。",
      "AI 面板接入 ChatGPT 文本流式响应和 PG 本地工具调用，保留原 API 地址、密钥、模型、上下文与 MCP 设置。",
      "修复活动模型名称显示，并使设置页从主区域打开。",
      "增加独立版本名称和旧版设置迁移，延续快捷键及其他配置。",
    ],
  },
  {
    version: "PG Custom / PG1.0",
    title: "自定义稳定基线",
    changes: [
      "文本节点增加最大宽度：短文本随内容自适应，达到上限自动换行，默认建议 15 个中文字符，可在设置中调整。",
      "新建、编辑及生长节点沿用最大宽度逻辑。",
      "自定义版本采用独立名称，官方新版本由用户手动决定更新。",
      "作为后续 PG1.x 增量开发的稳定基线。",
    ],
  },
];

const Author: React.FC<{ name: string; url: string }> = ({ name, url }: { name: string; url: string }) => {
  return (
    <span className="mt-1 font-medium underline underline-offset-4 hover:cursor-pointer" onClick={() => open(url)}>
      {name}
    </span>
  );
};
