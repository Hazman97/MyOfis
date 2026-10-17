import { describe, expect, test } from "bun:test";
import { compactDiff, lineDiff } from "../src/diff.ts";

describe("lineDiff", () => {
  test("marks added, removed and unchanged lines", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  test("empty before = everything added", () => {
    expect(lineDiff("", "x").map((l) => l.kind)).toEqual(["del", "add"]);
  });

  test("compactDiff hides long unchanged runs", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l10", "L10");
    const c = compactDiff(lineDiff(before, after), 1);
    expect(c[0]).toEqual({ kind: "gap", count: 9 });
    expect(c.filter((l) => l.kind !== "gap").map((l) => (l as { text: string }).text)).toEqual(["l9", "l10", "L10", "l11"]);
    expect(c.at(-1)).toEqual({ kind: "gap", count: 8 });
  });
});
