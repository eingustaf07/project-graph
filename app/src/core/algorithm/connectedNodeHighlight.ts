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
