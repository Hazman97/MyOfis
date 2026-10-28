import { describe, expect, test } from "bun:test";
import { cleanUploadName } from "../src/publisher.ts";

describe("cleanUploadName", () => {
  test("em dash and en dash become '-'", () => {
    expect(cleanUploadName("report—final.pdf")).toBe("report-final.pdf");
    expect(cleanUploadName("report–final.pdf")).toBe("report-final.pdf");
    expect(cleanUploadName("a—b–c")).toBe("a-b-c");
  });

  test("unsafe characters become '_'", () => {
    for (const ch of ["/", "\\", ":", "*", "?", "<", ">", "|"]) {
      expect(cleanUploadName(`a${ch}b`)).toBe("a_b");
    }
    expect(cleanUploadName("photo😀.jpg")).toBe("photo_.jpg");
    expect(cleanUploadName("a//b")).toBe("a_b");
  });

  test("keeps letters, digits, dot, dash, space and underscore", () => {
    expect(cleanUploadName("my file v2.0-final_backup.txt")).toBe("my file v2.0-final_backup.txt");
  });

  test("cuts names longer than 120 characters to 120", () => {
    const out = cleanUploadName("a".repeat(150));
    expect(out).toBe("a".repeat(120));
    expect(out.length).toBe(120);
    expect(cleanUploadName("b".repeat(121))).toBe("b".repeat(120));
    expect(cleanUploadName("c".repeat(120))).toBe("c".repeat(120));
  });
});
