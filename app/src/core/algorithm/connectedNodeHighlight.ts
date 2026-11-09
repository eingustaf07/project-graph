/** A fork blocks the walk toward its children, but still has a unique path back to its parent. */
export function collectChainNodeIds(
  nodeIds: Iterable<string>,
  edges: Iterable<{ source: { uuid: string }; target: { uuid: string } }>,
  roots: ReadonlySet<string>,
): Set<string> {
  const live = new Set(nodeIds);
  const parents = new Map<string, string | null>();
  const children = new Map<string, string | null>();
  function link(map: Map<string, string | null>, from: string, to: string) {
    if (!map.has(from)) map.set(from, to);
    else if (map.get(from) !== to) map.set(from, null);
  }
  for (const { source, target } of edges) {
    if (source.uuid === target.uuid || !live.has(source.uuid) || !live.has(target.uuid)) continue;
    link(parents, target.uuid, source.uuid);
    link(children, source.uuid, target.uuid);
  }
  const result = new Set<string>();
  for (const direction of [parents, children]) {
    const visited = new Set<string>();
    for (const root of roots) {
      if (!live.has(root)) continue;
      let id: string | null | undefined = root;
      while (id != null && !visited.has(id)) {
        result.add(id);
        visited.add(id);
        id = direction.get(id);
      }
    }
  }
  return result;
}

export function collectConnectedNodeIds(
  nodeIds: Iterable<string>,
  associations: Iterable<readonly { uuid: string }[]>,
  roots: Iterable<string>,
  scope: "direct" | "all" = "all",
): Set<string> {
  const neighbors = new Map<string, string[]>();
  for (const id of nodeIds) neighbors.set(id, []);
  const rootIds = new Set([...roots].filter((id) => neighbors.has(id)));
  if (scope === "direct") {
    const direct = new Set(rootIds);
    for (const members of associations) {
      if (!members.some((member) => rootIds.has(member.uuid))) continue;
      for (const member of members) if (neighbors.has(member.uuid)) direct.add(member.uuid);
    }
    return direct;
  }
  for (const members of associations) {
    const valid = [...new Set(members.map((member) => member.uuid).filter((id) => neighbors.has(id)))];
    // A star connects a hyperedge without materializing every pair of its members.
    for (let i = 1; i < valid.length; i++) {
      neighbors.get(valid[0])!.push(valid[i]);
      neighbors.get(valid[i])!.push(valid[0]);
    }
  }
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const root of rootIds)
    if (neighbors.has(root) && !visited.has(root)) {
      visited.add(root);
      queue.push(root);
    }
  for (let index = 0; index < queue.length; index++) {
    for (const neighbor of neighbors.get(queue[index])!)
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
  }
  return visited;
}
