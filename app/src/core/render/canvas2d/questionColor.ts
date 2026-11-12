import { Settings } from "@/core/service/Settings";
import { Color, colorInvert } from "@graphif/data-structures";

const questionYellow = new Color(255, 235, 59, 1);

export function isQuestionMarked(text: string | undefined): boolean {
  return !!Settings.questionMarkYellow && typeof text === "string" && /[?？]$/.test(text.trimEnd());
}

export function questionDisplayColor(text: string | undefined, original: Color): Color {
  return isQuestionMarked(text) ? questionYellow : original;
}

export function questionTextColor(text: string | undefined, original: Color, background: Color): Color {
  return isQuestionMarked(text) ? Color.Black : colorInvert(original.a === 1 ? original : background);
}
