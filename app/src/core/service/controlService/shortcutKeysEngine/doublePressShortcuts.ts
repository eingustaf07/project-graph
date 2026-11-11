export const doublePressShortcutPairs = [
  ["copy", "copyText"],
  ["selectHighlighted", "copyHighlightedText"],
] as const;

export function isDoublePressShortcut(id: string): boolean {
  return doublePressShortcutPairs.some(([first, second]) => id === first || id === second);
}
