export type ReplacementTarget = {
  uuid: string;
  text: string;
  locked: boolean;
  write: (text: string) => void;
};

export type ReplacementMatch = { target: ReplacementTarget; start: number; end: number };
export type ReplacementChange = { target: ReplacementTarget; before: string; after: string; count: number };

export function findReplacementMatches(targets: ReplacementTarget[], query: string, caseSensitive: boolean) {
  const matches: ReplacementMatch[] = [];
  if (!query) return matches;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, caseSensitive ? "g" : "gi");
  for (const target of targets) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(target.text)) !== null) {
      matches.push({ target, start: match.index, end: match.index + match[0].length });
    }
  }
  return matches;
}

export function planTextReplacements(matches: ReplacementMatch[], replacement: string): ReplacementChange[] {
  const byObject = new Map<string, ReplacementMatch[]>();
  for (const match of matches) {
    if (match.target.locked) continue;
    const group = byObject.get(match.target.uuid) ?? [];
    group.push(match);
    byObject.set(match.target.uuid, group);
  }
  const changes: ReplacementChange[] = [];
  for (const group of byObject.values()) {
    const target = group[0].target;
    let after = "",
      cursor = 0,
      count = 0;
    for (const match of group.sort((a, b) => a.start - b.start)) {
      after += target.text.slice(cursor, match.start) + replacement;
      if (target.text.slice(match.start, match.end) !== replacement) count++;
      cursor = match.end;
    }
    after += target.text.slice(cursor);
    if (after !== target.text) changes.push({ target, before: target.text, after, count });
  }
  return changes;
}
