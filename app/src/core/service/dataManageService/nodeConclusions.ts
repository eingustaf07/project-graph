import { Color } from "@graphif/data-structures";

export const conclusionBlue = new Color(52, 103, 180, 1);

export function expandConclusionShortcut(text: string): string {
  return /^\/jl/i.test(text) ? `结论:${text.slice(3)}` : text;
}

export function isConclusionText(text: string | undefined): boolean {
  return typeof text === "string" && /^结论[:：]/.test(text.replace(/^(?:✅|❌) /, ""));
}

export function hasTaskStatus(text: string): boolean {
  return /^(?:✅|❌) /.test(text);
}
