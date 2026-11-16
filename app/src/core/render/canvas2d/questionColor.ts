import { Settings } from "@/core/service/Settings";
import { Color, colorInvert, mixColors } from "@graphif/data-structures";
import {
  conclusionBlue,
  conjecturePurple,
  hasTaskStatus,
  isConclusionText,
  isConjectureText,
} from "@/core/service/dataManageService/nodeConclusions";

const questionYellow = new Color(255, 235, 59, 1);
const taskFrameColors = new WeakMap<Color, { key: string; color: Color }>();

function luminance(color: Color): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

export function taskFrameDisplayColor(text: string, original: Color, background: Color): Color {
  if (!hasTaskStatus(text)) return original;
  const key = `${original.r},${original.g},${original.b},${original.a}:${background.r},${background.g},${background.b}`;
  const cached = taskFrameColors.get(original);
  if (cached?.key === key) return cached.color;
  const backgroundLuminance = luminance(background);
  const contrast = (color: Color) => {
    const visible = mixColors(background, color, color.a);
    const value = luminance(visible);
    return (Math.max(value, backgroundLuminance) + 0.05) / (Math.min(value, backgroundLuminance) + 0.05);
  };
  let result = original;
  if (contrast(original) < 4.5) {
    // The task extension's fill colors need more contrast when used as thin strokes and text.
    const target = backgroundLuminance < 0.179 ? Color.White : Color.Black;
    let low = 0,
      high = 1;
    for (let i = 0; i < 10; i++) {
      const middle = (low + high) / 2;
      if (contrast(mixColors(original, target, middle)) >= 4.5) high = middle;
      else low = middle;
    }
    result = mixColors(original, target, high);
  }
  taskFrameColors.set(original, { key, color: result });
  return result;
}

export function isQuestionMarked(text: string | undefined): boolean {
  return (
    !!Settings.questionMarkYellow &&
    typeof text === "string" &&
    !isConclusionText(text) &&
    /[?？]$/.test(text.trimEnd())
  );
}

export function questionDisplayColor(text: string | undefined, original: Color, conclusions = false): Color {
  if (conclusions && isConjectureText(text) && !hasTaskStatus(text!)) return conjecturePurple;
  if (conclusions && isConclusionText(text) && !hasTaskStatus(text!)) return conclusionBlue;
  return showQuestionYellow(text) ? questionYellow : original;
}

export function questionTextColor(
  text: string | undefined,
  original: Color,
  background: Color,
  conclusions = false,
): Color {
  if (conclusions && isConjectureText(text) && !hasTaskStatus(text!)) return colorInvert(conjecturePurple);
  if (conclusions && isConclusionText(text) && !hasTaskStatus(text!)) return colorInvert(conclusionBlue);
  return showQuestionYellow(text) ? Color.Black : colorInvert(original.a === 1 ? original : background);
}

function showQuestionYellow(text: string | undefined): boolean {
  // Both installed task extensions toggle these prefixes together with their status colors.
  return isQuestionMarked(text) && !text?.startsWith("✅ ") && !text?.startsWith("❌ ");
}

export function isYellowQuestionNode(text: string | undefined): boolean {
  return !isConjectureText(text) && showQuestionYellow(text);
}
