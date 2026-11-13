import { Settings } from "@/core/service/Settings";
import { Color, colorInvert } from "@graphif/data-structures";

const questionYellow = new Color(255, 235, 59, 1);

export function isQuestionMarked(text: string | undefined): boolean {
  return !!Settings.questionMarkYellow && typeof text === "string" && /[?？]$/.test(text.trimEnd());
}

export function questionDisplayColor(text: string | undefined, original: Color): Color {
  return showQuestionYellow(text) ? questionYellow : original;
}

export function questionTextColor(text: string | undefined, original: Color, background: Color): Color {
  return showQuestionYellow(text) ? Color.Black : colorInvert(original.a === 1 ? original : background);
}

function showQuestionYellow(text: string | undefined): boolean {
  // Both installed task extensions toggle these prefixes together with their status colors.
  return isQuestionMarked(text) && !text?.startsWith("✅ ") && !text?.startsWith("❌ ");
}
