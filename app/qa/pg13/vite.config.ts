import { defineConfig } from "vite";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-oxc";

const root = path.resolve(import.meta.dirname, "../..");
const stubs = new Map([
  [
    "@/core/Project",
    'export class Project {}; export const ProjectState={Saved:"saved",Unsaved:"unsaved"}; export const service=()=>target=>target;',
  ],
  [
    "@/core/service/Settings",
    'export const Settings={clipboardPasteMode:"tauri",textNodeMaxCharWidth:15,textNodePasteSizeAdjustMode:"auto",defaultFontFamily:"Microsoft YaHei",historyManagerMode:"memoryEfficient",historySize:100,showDebug:false,watch:()=>()=>{},ignoreTextNodeTextRenderLessThanFontSize:0};',
  ],
  ["@/core/render/canvas2d/renderer", "export const Renderer={FONT_SIZE:32,NODE_PADDING:14,NODE_ROUNDED_RADIUS:8};"],
  [
    "@/core/stage/stageObject/tools/entityDetailsManager",
    'export class DetailsManager { static markdownToDetails(text) { return [{type:"p",children:[{text}]}]; } }',
  ],
  ["@/core/service/feedbackService/SoundService", "export const SoundService={play:new Proxy({},{get:()=>()=>{}})};"],
  ["@/core/service/Telemetry", "export const Telemetry={event:async()=>{}};"],
  ["@/core/service/controlService/shortcutKeysEngine/KeyBindsUI", "export const KeyBindsUI={getAllUIKeyBinds:()=>[]};"],
  [
    "@/utils/platform",
    'export const isMac=false, isWindows=true, isLinux=false, isWeb=false; export const family=()=>"windows";',
  ],
  [
    "@tauri-apps/plugin-clipboard-manager",
    'export const readText=async()=>window.pgClipboard||""; export const writeText=async(text)=>{window.pgClipboard=text}; export const readImage=async()=>{throw new Error("No test image")};',
  ],
]);

export default defineConfig({
  root,
  plugins: [
    {
      name: "pg13-desktop-service-stubs",
      enforce: "pre",
      resolveId(id, importer) {
        if (stubs.has(id)) return `\0pg13:${id}`;
        const candidate = (id.startsWith(".") && importer ? path.resolve(path.dirname(importer), id) : id)
          .replaceAll("\\", "/")
          .replace(/\.(tsx?|jsx?)$/, "");
        for (const key of stubs.keys()) {
          if (candidate === path.join(root, "src", key.slice(2)).replaceAll("\\", "/")) return `\0pg13:${key}`;
        }
        if (id === "virtual:original-class-name") return `\0${id}`;
      },
      load(id) {
        if (id.startsWith("\0pg13:")) return stubs.get(id.slice("\0pg13:".length));
        if (id === "\0virtual:original-class-name") return "export const getOriginalNameOf=value=>value.name";
      },
    },
    tailwindcss(),
    react(),
  ],
  resolve: { alias: { "@": path.join(root, "src") } },
  server: { host: "127.0.0.1", port: 1494, strictPort: true },
});
