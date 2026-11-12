import type { Project } from "@/core/Project";
import type { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { Settings } from "@/core/service/Settings";
import { Vector, colorInvert } from "@graphif/data-structures";

export function renderTableNode(project: Project, node: TextNode) {
  const layout = node.getTableLayout(),
    scale = project.camera.currentScale;
  const origin = project.renderer.transformWorld2View(node.rectangle.location);
  const width = node.rectangle.width * scale,
    height = node.rectangle.height * scale;
  const ctx = project.canvas.ctx;
  const lineColor = project.stageStyleManager.currentStyle.StageObjectBorder;
  const textColor =
    node.color.a === 1 ? colorInvert(node.color) : colorInvert(project.stageStyleManager.currentStyle.Background);
  const drawText =
    Settings.alwaysRenderNodeText || node.getFontSize() * scale > Settings.ignoreTextNodeTextRenderLessThanFontSize;
  ctx.save();
  ctx.beginPath();
  ctx.rect(origin.x, origin.y, width, height);
  ctx.clip();
  try {
    let y = origin.y;
    for (let r = 0; r < layout.rowHeights.length; r++) {
      const rowHeight = layout.rowHeights[r] * scale;
      if (project.renderer.h > 0 && y > project.renderer.h) break;
      if (y + rowHeight >= 0 && drawText) {
        let x = origin.x;
        for (let c = 0; c < layout.columnWidths.length; c++) {
          const columnWidth = layout.columnWidths[c] * scale;
          if (project.renderer.w > 0 && x > project.renderer.w) break;
          if (x + columnWidth >= 0)
            layout.lines[r][c].forEach((line, i) =>
              project.textRenderer.renderText(
                line,
                new Vector(
                  x + node.getPadding() * scale,
                  y + (node.getPadding() + node.getFontSize() / 4 + i * node.getFontSize() * 1.5) * scale,
                ),
                node.getFontSize() * scale,
                textColor,
                node.fontFamily || undefined,
                node.fontWeight || undefined,
              ),
            );
          x += columnWidth;
        }
      }
      y += rowHeight;
      if (y >= 0 && y < origin.y + height)
        project.curveRenderer.renderSolidLine(
          new Vector(origin.x, y),
          new Vector(origin.x + width, y),
          lineColor,
          Math.max(0.5, scale),
        );
    }
    let x = origin.x;
    for (const columnWidth of layout.columnWidths) {
      x += columnWidth * scale;
      if (project.renderer.w > 0 && x > project.renderer.w) break;
      if (x >= 0 && x < origin.x + width)
        project.curveRenderer.renderSolidLine(
          new Vector(x, origin.y),
          new Vector(x, origin.y + height),
          lineColor,
          Math.max(0.5, scale),
        );
    }
  } finally {
    ctx.restore();
  }
}
