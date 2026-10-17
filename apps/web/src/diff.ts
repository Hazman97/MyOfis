export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Line diff (LCS) for showing a skill patch: small inputs only (skills are ≤ 20k chars). */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: "del", text: a[i++]! });
    else out.push({ kind: "add", text: b[j++]! });
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

/** Hide long unchanged runs, keeping `context` lines around each change. */
export function compactDiff(lines: DiffLine[], context = 2): (DiffLine | { kind: "gap"; count: number })[] {
  const keep = lines.map((l, i) => l.kind !== "same" || lines.slice(Math.max(0, i - context), i + context + 1).some((x) => x.kind !== "same"));
  const out: (DiffLine | { kind: "gap"; count: number })[] = [];
  let gap = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (gap) out.push({ kind: "gap", count: gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ kind: "gap", count: gap });
  return out;
}
