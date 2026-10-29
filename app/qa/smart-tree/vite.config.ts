import { defineConfig } from "vite";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const stubbed = new Map([
  [
    "@/core/Project",
    'export class Project {}; export const ProjectState={Saved:"saved",Unsaved:"unsaved"}; export const service=()=>target=>target;',
  ],
  [
    "@/core/service/Settings",
    'export const Settings={enableSmartTreeArrange:true,smartTreeArrangeMode:"preserve",smartTreeArrangeDirection:"right",smartTreeLevelGap:64,smartTreeNodeGap:24,smartTreeSubtreeGap:40,textNodeMaxCharWidth:15,defaultFontFamily:"Microsoft YaHei",historyManagerMode:"memoryEfficient",historySize:100,showDebug:false,watch:()=>()=>{},ignoreTextNodeTextRenderLessThanFontSize:0};',
  ],
  ["@/core/render/canvas2d/renderer", "export const Renderer={FONT_SIZE:32,NODE_PADDING:14,NODE_ROUNDED_RADIUS:8};"],
  ["@/core/stage/stageObject/entity/Section", "export class Section {}"],
  ["@/core/stage/stageObject/tools/entityDetailsManager", "export class DetailsManager {}"],
  ["@/core/service/controlService/shortcutKeysEngine/KeyBindsUI", "export const KeyBindsUI={getAllUIKeyBinds:()=>[]};"],
]);

// Only the test host and desktop-only services are substituted. Nodes, edges, measurements,
// Canvas renderers, layout, history and serialization below are the actual application modules.
export default defineConfig({
  root,
  plugins: [
    {
      name: "smart-tree-visual-host",
      enforce: "pre",
      resolveId(id, importer) {
        if (stubbed.has(id)) return `\0smart-tree:${id}`;
        const candidate = (id.startsWith(".") && importer ? path.resolve(path.dirname(importer), id) : id)
          .replaceAll("\\", "/")
          .replace(/\.(tsx?|jsx?)$/, "");
        for (const key of stubbed.keys()) {
          if (candidate === path.join(root, "src", key.slice(2)).replaceAll("\\", "/")) return `\0smart-tree:${key}`;
        }
        if (id === "virtual:original-class-name") return `\0${id}`;
      },
      load(id) {
        if (id.startsWith("\0smart-tree:")) return stubbed.get(id.slice("\0smart-tree:".length));
        if (id === "\0virtual:original-class-name") return "export const getOriginalNameOf=value=>value.name";
      },
    },
  ],
  resolve: { alias: { "@": path.join(root, "src") } },
  server: { host: "127.0.0.1", port: 1493, strictPort: true },
});
