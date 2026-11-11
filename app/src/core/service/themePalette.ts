export const defaultPalette = { background: "#171717", foreground: "#eeeeee", primary: "#007b65" };
export type ThemePalette = typeof defaultPalette;

export function paletteId({ background, foreground, primary }: ThemePalette) {
  return "pg-palette-" + [background, foreground, primary].map((color) => color.slice(1).toLowerCase()).join("-");
}

export function readPalette(id: string): ThemePalette | undefined {
  const match = /^pg-palette-([\da-f]{6})-([\da-f]{6})-([\da-f]{6})$/i.exec(id);
  if (match) return { background: "#" + match[1], foreground: "#" + match[2], primary: "#" + match[3] };
}

export function contrastingText(hex: string) {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}
