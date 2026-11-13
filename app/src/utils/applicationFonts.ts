import { DEFAULT_FONT_FAMILY } from "@/core/service/ProjectToolSettingsSchema";
import fontUrl from "@/assets/fonts/retro-pixel/RetroPixelUI-Regular.ttf?url";

export function applyApplicationFont(root: HTMLElement = document.documentElement) {
  // Use the installed family directly in each WebView, independent of process-specific font hooks.
  root.style.setProperty("--pg-ui-font-family", DEFAULT_FONT_FAMILY);
  root.style.setProperty("--font-sans", DEFAULT_FONT_FAMILY);
}

let loading: Promise<boolean> | undefined;
export function loadApplicationFont(): Promise<boolean> {
  loading ??= (async () => {
    if (typeof FontFace === "undefined" || !document.fonts) return false;
    const face = new FontFace("Retro Pixel UI", `url(${JSON.stringify(fontUrl)})`);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        face.load(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Font load timed out")), 2500);
        }),
      ]);
      // Do not register a late font after the timeout: cached text metrics must remain consistent.
      document.fonts.add(face);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  })();
  return loading;
}
