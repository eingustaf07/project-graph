import { appDataDir, homeDir, join } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";

// A Windows packaged launcher can present a different physical Roaming directory
// under the same path. A provisioned daily development profile lives outside it.
let sharedRoot: Promise<string | undefined> | undefined;
async function profileRoot() {
  if (!import.meta.env.DEV || import.meta.env.LR_PG_DEVELOPMENT_SESSION !== "1") return;
  sharedRoot ??= (async () => {
    const root = await join(await homeDir(), ".project-graph-e", "preferences");
    return await exists(await join(root, "profile-ready-v1")) ? root : undefined;
  })();
  return sharedRoot;
}

export async function preferencePath(file: string) {
  const root = await profileRoot();
  return root ? join(root, file) : file;
}

export async function extensionsPath() {
  return join((await profileRoot()) ?? await appDataDir(), "extensions");
}
