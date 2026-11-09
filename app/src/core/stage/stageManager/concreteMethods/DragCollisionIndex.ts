import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import type { Rectangle } from "@graphif/shapes";

/** Updated during one movement batch, including neighbors pushed by collisions. */
export class DragCollisionIndex {
  private cells = new Map<string, Set<TextNode>>();
  private memberships = new Map<TextNode, string[]>();
  private oversized = new Set<TextNode>();
  private others: Entity[];
  private order = new Map<Entity, number>();

  constructor(entities: Entity[]) {
    entities.forEach((entity, index) => this.order.set(entity, index));
    this.others = entities.filter((entity) => !(entity instanceof TextNode));
    for (const entity of entities) if (entity instanceof TextNode) this.update(entity);
  }

  private keys(box: Rectangle): string[] | null {
    const left = Math.floor(box.left / 256),
      right = Math.floor(box.right / 256);
    const top = Math.floor(box.top / 256),
      bottom = Math.floor(box.bottom / 256);
    if (!Number.isFinite(left + right + top + bottom) || (right - left + 1) * (bottom - top + 1) > 64) return null;
    const keys: string[] = [];
    for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) keys.push(x + "," + y);
    return keys;
  }

  update(node: TextNode) {
    for (const key of this.memberships.get(node) ?? []) {
      const cell = this.cells.get(key)!;
      cell.delete(node);
      if (!cell.size) this.cells.delete(key);
    }
    this.memberships.delete(node);
    this.oversized.delete(node);
    const keys = this.keys(node.rectangle);
    if (!keys) {
      this.oversized.add(node);
      return;
    }
    this.memberships.set(node, keys);
    for (const key of keys) {
      if (!this.cells.has(key)) this.cells.set(key, new Set());
      this.cells.get(key)!.add(node);
    }
  }

  query(node: TextNode): Entity[] {
    const keys = this.keys(node.rectangle);
    const candidates = new Set<TextNode>(this.oversized);
    if (keys) {
      for (const key of keys) for (const other of this.cells.get(key) ?? []) candidates.add(other);
    } else {
      for (const other of this.memberships.keys()) candidates.add(other);
    }
    return [...this.others, ...[...candidates].filter((other) => node.rectangle.isCollideWith(other.rectangle))].sort(
      (a, b) => this.order.get(a)! - this.order.get(b)!,
    );
  }
}
