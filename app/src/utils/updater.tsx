import { open } from "@tauri-apps/plugin-shell";
import { isMobile } from "@/utils/platform";

export async function checkUpdate() {
  if (isMobile) return null;
  // Official binaries would replace this fork's custom behavior.
  await open("https://github.com/graphif/project-graph/releases");
  return null;
}
