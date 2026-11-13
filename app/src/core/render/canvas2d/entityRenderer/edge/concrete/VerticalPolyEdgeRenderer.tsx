import { Color, ProgressNumber, Vector } from "@graphif/data-structures";
import { Line } from "@graphif/shapes";
import { Project, service } from "@/core/Project";
import { CircleFlameEffect } from "@/core/service/feedbackService/effectEngine/concrete/CircleFlameEffect";
import { LineCuttingEffect } from "@/core/service/feedbackService/effectEngine/concrete/LineCuttingEffect";
import { Effect } from "@/core/service/feedbackService/effectEngine/effectObject";
import { Settings } from "@/core/service/Settings";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import { ConnectPoint } from "@/core/stage/stageObject/entity/ConnectPoint";
import { SvgUtils } from "@/core/render/svg/SvgUtils";
import { EdgeRendererClass } from "@/core/render/canvas2d/entityRenderer/edge/EdgeRendererClass";

/**
 * 折线渲染器
 */
@service("verticalPolyEdgeRenderer")
export class VerticalPolyEdgeRenderer extends EdgeRendererClass {
  constructor(private readonly project: Project) {
    super();
  }

  getCuttingEffects(edge: LineEdge): Effect[] {
    const midLocation = edge.bodyLine.midPoint();
    return [
      new LineCuttingEffect(
        new ProgressNumber(0, 15),
        midLocation,
        edge.bodyLine.start,
        new Color(255, 0, 0, 1),
        new Color(255, 0, 0, 1),
        20,
      ),
      new LineCuttingEffect(
        new ProgressNumber(0, 15),
        midLocation,
        edge.bodyLine.end,
        new Color(255, 0, 0, 1),
        new Color(255, 0, 0, 1),
        20,
      ),
      new CircleFlameEffect(new ProgressNumber(0, 15), edge.bodyLine.midPoint(), 50, new Color(255, 0, 0, 1)),
    ];
  }

  getConnectedEffects(
    startNode: ConnectableEntity,
    toNode: ConnectableEntity,
    sourceRectangleRate?: Vector,
    targetRectangleRate?: Vector,
  ): Effect[] {
    const sourceRate = sourceRectangleRate ?? Vector.same(0.5);
    const targetRate = targetRectangleRate ?? Vector.same(0.5);

    const isCenterRate = (r: Vector): boolean => r.x === 0.5 && r.y === 0.5;

    const sourceRect = startNode.collisionBox.getRectangle();
    const targetRect = toNode.collisionBox.getRectangle();
    const sourceInner = sourceRect.getInnerLocationByRateVector(sourceRate);
    const targetInner = targetRect.getInnerLocationByRateVector(targetRate);
    const line = new Line(sourceInner, targetInner);

    let start: Vector;
    if (startNode instanceof ConnectPoint) {
      start = startNode.geometryCenter;
    } else if (!isCenterRate(sourceRate)) {
      start = Edge.getExactEdgePositionByRate(sourceRect, sourceRate) ?? sourceInner;
    } else {
      start = sourceRect.getLineIntersectionPoint(line);
    }

    let end: Vector;
    if (toNode instanceof ConnectPoint) {
      end = toNode.geometryCenter;
    } else if (!isCenterRate(targetRate)) {
      end = Edge.getExactEdgePositionByRate(targetRect, targetRate) ?? targetInner;
    } else {
      end = targetRect.getLineIntersectionPoint(line);
    }

    return [
      new CircleFlameEffect(new ProgressNumber(0, 15), start, 80, new Color(83, 175, 29, 1)),
      new LineCuttingEffect(
        new ProgressNumber(0, 30),
        start,
        end,
        new Color(78, 201, 176, 1),
        new Color(83, 175, 29, 1),
        20,
      ),
    ];
  }

  /**
   * 起始点在目标点的哪个区域，返回起始点朝向终点的垂直向量
   *    上
   * 左 end 右
   *    下
   * 如果起点在左侧，返回 "->" 即 new Vector(1, 0)
   * @param edge
   * @returns
   */
  getVerticalDirection(edge: LineEdge): Vector {
    const startLocation = edge.source.collisionBox.getRectangle().center;
    const endLocation = edge.target.collisionBox.getRectangle().center;
    const startToEnd = endLocation.subtract(startLocation);
    if (startLocation.x < endLocation.x) {
      // |左侧
      if (startLocation.y < endLocation.y) {
        // |左上
        if (Math.abs(startToEnd.y) > Math.abs(startToEnd.x)) {
          // ↓
          return new Vector(0, 1);
        } else {
          // →
          return new Vector(1, 0);
        }
      } else {
        // |左下
        if (Math.abs(startToEnd.y) > Math.abs(startToEnd.x)) {
          // ↑
          return new Vector(0, -1);
        } else {
          // →
          return new Vector(1, 0);
        }
      }
    } else {
      // |右侧
      if (startLocation.y < endLocation.y) {
        // |右上
        if (Math.abs(startToEnd.y) > Math.abs(startToEnd.x)) {
          // ↓
          return new Vector(0, 1);
        } else {
          // ←
          return new Vector(-1, 0);
        }
      } else {
        // |右下
        if (Math.abs(startToEnd.y) > Math.abs(startToEnd.x)) {
          // ↑
          return new Vector(0, -1);
        } else {
          // ←
          return new Vector(-1, 0);
        }
      }
    }
  }

  /**
   * 固定长度
   */
  fixedLength: number = 100;

  // debug 测试
  renderTest(edge: LineEdge) {
    for (let i = 0; i < 4; i++) {
      this.project.curveRenderer.renderSolidLine(
        this.project.renderer.transformWorld2View(edge.target.collisionBox.getRectangle().center),
        this.project.renderer.transformWorld2View(
          edge.target.collisionBox.getRectangle().center.add(new Vector(100, 0).rotateDegrees(45 + 90 * i)),
        ),
        Color.Green,
        1,
      );
    }
  }
  gaussianFunction(x: number) {
    // e ^(-x^2)
    return Math.exp(-(x * x) / 10000);
  }

  public renderNormalState(edge: LineEdge): void {
    const points = edge.orthogonalPath;
    if (points.length < 2) return;
    const color = edge.color.equals(Color.Transparent)
      ? this.project.stageStyleManager.currentStyle.StageObjectBorder
      : edge.color;
    const scale = this.project.camera.currentScale;
    const width = edge.edgeWidth * scale;
    for (let i = 1; i < points.length; i++) {
      const a = this.project.renderer.transformWorld2View(points[i - 1]);
      const b = this.project.renderer.transformWorld2View(points[i]);
      if (edge.lineType === "dashed") this.project.curveRenderer.renderDashedLine(a, b, color, width, 10 * scale);
      else if (edge.lineType === "double") this.project.curveRenderer.renderDoubleLine(a, b, color, width, 5 * scale);
      else this.project.curveRenderer.renderSolidLine(a, b, color, width);
    }
    if (edge.text.trim())
      this.project.textRenderer.renderMultiLineTextFromCenterWithStroke(
        edge.text,
        this.project.renderer.transformWorld2View(edge.textRectangle.center),
        edge.textFontSize * scale,
        color,
        this.project.stageStyleManager.currentStyle.Background,
      );
    if (this.shouldRenderTargetArrow(edge))
      this.project.edgeRenderer.renderArrowByType(
        points.at(-1)!,
        points[0],
        points.at(-1)!.subtract(points.at(-2)!).normalize(),
        15,
        color,
        edge.arrowType || "default",
        edge.edgeWidth,
        points[1].subtract(points[0]).normalize(),
      );
  }

  public renderShiftingState(edge: LineEdge): void {
    this.renderNormalState(edge);
  }
  private shouldRenderTargetArrow(edge: LineEdge): boolean {
    return (
      Settings.showBidirectionalArrows ||
      !(Settings.hideArrowWhenPointingToConnectPoint && edge.target instanceof ConnectPoint)
    );
  }

  public renderCycleState(edge: LineEdge): void {
    // 自环
    this.project.shapeRenderer.renderArc(
      this.project.renderer.transformWorld2View(edge.target.collisionBox.getRectangle().location),
      (edge.target.collisionBox.getRectangle().size.y / 2) * this.project.camera.currentScale,
      Math.PI / 2,
      0,
      new Color(204, 204, 204),
      2 * this.project.camera.currentScale,
    );
    // 画箭头
    {
      if (this.shouldRenderTargetArrow(edge)) {
        const size = 15;
        const direction = new Vector(1, 0).rotateDegrees(15);
        const endPoint = edge.target.collisionBox.getRectangle().leftCenter;
        this.project.edgeRenderer.renderArrowByType(
          endPoint,
          endPoint,
          direction,
          size,
          edge.color,
          edge.arrowType || "default",
          2,
        );
      }
    }
  }
  public getNormalStageSvg(edge: LineEdge): React.ReactNode {
    const points = edge.orthogonalPath;
    if (points.length < 2) return null;
    const color = edge.color.equals(Color.Transparent)
      ? this.project.stageStyleManager.currentStyle.StageObjectBorder
      : edge.color;
    const end = points.at(-1)!;
    return (
      <>
        <polyline
          points={points.map((p) => p.x + "," + p.y).join(" ")}
          fill="none"
          stroke={color.toString()}
          strokeWidth={edge.edgeWidth}
          strokeDasharray={edge.lineType === "dashed" ? "10 10" : undefined}
        />
        {edge.text.trim() &&
          SvgUtils.textFromCenterWithStroke(
            edge.text,
            edge.textRectangle.center,
            edge.textFontSize,
            color,
            this.project.stageStyleManager.currentStyle.Background,
          )}
        {this.shouldRenderTargetArrow(edge) &&
          this.project.edgeRenderer.generateEdgeArrowsSvg(
            end,
            points[0],
            end.subtract(points.at(-2)!).normalize(),
            15,
            color,
            points[1].subtract(points[0]).normalize(),
          )}
      </>
    );
  }
  public getCycleStageSvg(): React.ReactNode {
    return <></>;
  }
  public getShiftingStageSvg(): React.ReactNode {
    return <></>;
  }

  public renderVirtualEdge(startNode: ConnectableEntity, mouseLocation: Vector, sourceRectangleRate?: Vector): void {
    const rate = sourceRectangleRate ?? Vector.same(0.5);
    const startRect = startNode.collisionBox.getRectangle();

    const isCenterRate = (r: Vector): boolean => r.x === 0.5 && r.y === 0.5;

    const startInner = startRect.getInnerLocationByRateVector(rate);
    let start: Vector;
    if (startNode instanceof ConnectPoint) {
      start = startNode.geometryCenter;
    } else if (!isCenterRate(rate)) {
      start = Edge.getExactEdgePositionByRate(startRect, rate) ?? startInner;
    } else {
      start = startRect.getLineIntersectionPoint(new Line(startInner, mouseLocation));
    }

    const end = mouseLocation;
    const colorStart = new Color(255, 255, 255, 0);
    const colorEnd = new Color(255, 255, 255, 0.5);
    this.project.curveRenderer.renderGradientLine(
      this.project.renderer.transformWorld2View(start),
      this.project.renderer.transformWorld2View(end),
      colorStart,
      colorEnd,
      2,
    );

    const direction = end.subtract(start);
    if (direction.magnitude() > 0) {
      this.project.edgeRenderer.renderArrowHead(end, direction.normalize(), 15, colorEnd);
    }
  }

  public renderVirtualConfirmedEdge(
    startNode: ConnectableEntity,
    endNode: ConnectableEntity,
    sourceRectangleRate?: Vector,
    targetRectangleRate?: Vector,
  ): void {
    const sourceRate = sourceRectangleRate ?? Vector.same(0.5);
    const targetRate = targetRectangleRate ?? Vector.same(0.5);
    const startRect = startNode.collisionBox.getRectangle();
    const endRect = endNode.collisionBox.getRectangle();

    const isCenterRate = (r: Vector): boolean => r.x === 0.5 && r.y === 0.5;

    const startInner = startRect.getInnerLocationByRateVector(sourceRate);
    const endInner = endRect.getInnerLocationByRateVector(targetRate);
    const line = new Line(startInner, endInner);

    let start: Vector;
    if (startNode instanceof ConnectPoint) {
      start = startNode.geometryCenter;
    } else if (!isCenterRate(sourceRate)) {
      start = Edge.getExactEdgePositionByRate(startRect, sourceRate) ?? startInner;
    } else {
      start = startRect.getLineIntersectionPoint(line);
    }

    let end: Vector;
    if (endNode instanceof ConnectPoint) {
      end = endNode.geometryCenter;
    } else if (!isCenterRate(targetRate)) {
      end = Edge.getExactEdgePositionByRate(endRect, targetRate) ?? endInner;
    } else {
      end = endRect.getLineIntersectionPoint(line);
    }

    const colorStart = new Color(0, 255, 0, 0);
    const colorEnd = new Color(0, 255, 0, 0.5);
    this.project.curveRenderer.renderGradientLine(
      this.project.renderer.transformWorld2View(start),
      this.project.renderer.transformWorld2View(end),
      colorStart,
      colorEnd,
      2,
    );

    const direction = end.subtract(start);
    if (direction.magnitude() > 0) {
      this.project.edgeRenderer.renderArrowHead(end, direction.normalize(), 15, colorEnd);
    }
  }
}
