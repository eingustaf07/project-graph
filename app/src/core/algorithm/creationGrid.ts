import { Settings } from "@/core/service/Settings";
import type { Project } from "@/core/Project";
import { Rectangle } from "@graphif/shapes";
import { Vector } from "@graphif/data-structures";

export function creationGridGap(project: Project): number {
  if (!Settings.snapNewNodesToGrid || !(Settings.showBackgroundHorizontalLines && Settings.showBackgroundVerticalLines))
    return 0;
  return project.backgroundRenderer?.getCurrentGap() ?? 0;
}

const onGrid = (value: number, gap: number) => Math.abs(value / gap - Math.round(value / gap)) < 1e-8;

// Keep shared layer coordinates together. Each axis may use either rectangle edge.
function snapAxis(starts: number[], sizes: number[], gap: number) {
  const groups = new Map<number, number[]>();
  starts.forEach((start, i) => {
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start)!.push(i);
  });
  const byEnd = starts.map((_, i) => i).sort((a, b) => starts[a] + sizes[a] - starts[b] - sizes[b]);
  const snapped: number[] = [];
  let nextEnd = 0,
    minimum = -Infinity;
  for (const [start, members] of [...groups].sort((a, b) => a[0] - b[0])) {
    while (
      nextEnd < byEnd.length &&
      starts[byEnd[nextEnd]] + sizes[byEnd[nextEnd]] <= start &&
      starts[byEnd[nextEnd]] < start
    ) {
      const j = byEnd[nextEnd++];
      minimum = Math.max(minimum, snapped[j] + sizes[j] + (starts[j] + sizes[j] < start ? 0.001 : 0));
    }
    const offsets = [0, sizes[members[0]]];
    const candidates = offsets
      .map((offset) => {
        const nearest = Math.round((start + offset) / gap) * gap - offset;
        return nearest < minimum ? Math.ceil((minimum + offset) / gap) * gap - offset : nearest;
      })
      .filter((at) => members.every((i) => onGrid(at, gap) || onGrid(at + sizes[i], gap)));
    const at = candidates.sort((a, b) => Math.abs(a - start) - Math.abs(b - start))[0];
    members.forEach((i) => {
      snapped[i] = at;
    });
    minimum = Math.max(minimum, at);
  }
  return snapped;
}

export function gridLocations(rects: Rectangle[], gap: number): Vector[] {
  const xs = snapAxis(
    rects.map((r) => r.left),
    rects.map((r) => r.width),
    gap,
  );
  const ys = snapAxis(
    rects.map((r) => r.top),
    rects.map((r) => r.height),
    gap,
  );
  return xs.map((x, i) => new Vector(x, ys[i]));
}
