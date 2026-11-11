export function isSelectionMode(mode: string): boolean {
  return mode === "selectAndMove" || mode === "accumulateSelection";
}
