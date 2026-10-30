// Desktop clipboard transport only. Image conversion, attachments, nodes and drawing remain production code.
type FixtureWindow = Window & {
  pgClipboard?: string;
  pgDenyTextRead?: boolean;
  pgClipboardImage?: { width: number; height: number; rgba: number[] };
  pgClipboardFiles?: Record<string, number[]>;
  pgImageHandlesOpened?: number;
  pgImageHandlesClosed?: number;
};
const state = window as FixtureWindow;
export const readText = async () => {
  if (state.pgDenyTextRead) throw new Error("Clipboard has no text format");
  return state.pgClipboard ?? "";
};
export const writeText = async (text: string) => {
  state.pgClipboard = text;
};
export const readImage = async () => {
  const image = state.pgClipboardImage;
  if (!image) throw new Error("No native test image");
  state.pgImageHandlesOpened = (state.pgImageHandlesOpened ?? 0) + 1;
  let closed = false;
  return {
    size: async () => ({ width: image.width, height: image.height }),
    rgba: async () => new Uint8Array(image.rgba),
    close: async () => {
      if (closed) throw new Error("Image resource closed twice");
      closed = true;
      state.pgImageHandlesClosed = (state.pgImageHandlesClosed ?? 0) + 1;
    },
  };
};
export const invoke = async (command: string) => {
  if (command !== "read_clipboard_image_paths") throw new Error(`Unexpected test command: ${command}`);
  return Object.keys(state.pgClipboardFiles ?? {});
};
export const readClipboardImagePaths = () => invoke("read_clipboard_image_paths");
export const readFile = async (path: string) => {
  const bytes = state.pgClipboardFiles?.[path];
  if (!bytes) throw new Error("Test file missing");
  return new Uint8Array(bytes);
};
