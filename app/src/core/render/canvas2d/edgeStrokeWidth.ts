import { Settings } from "@/core/service/Settings";

export function edgeStrokeWidth(width: number): number {
  return width * (Settings.edgeWidthScale ?? 1.5);
}
