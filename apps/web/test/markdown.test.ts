import { describe, expect, test } from "bun:test";
import { escapeHtml, formatInline, renderMarkdown } from "../src/markdown.ts";

describe("markdown renderer", () => {
  test("escapeHtml escapes dangerous characters", () => {
    expect(escapeHtml("<script>alert('xss') & \"test\"</script>")).toBe(
      "&lt;script&gt;alert(&#39;xss&#39;) &amp; &quot;test&quot;&lt;/script&gt;",
    );
  });

  test("formatInline handles bold text", () => {
    expect(formatInline("Hello **world**!")).toBe("Hello <strong>world</strong>!");
    expect(formatInline("**A** and **B**")).toBe("<strong>A</strong> and <strong>B</strong>");
  });

  test("renders headings #, ##, ###", () => {
    const md = [
      "# Nota Mesyuarat",
      "## Keputusan Utama",
      "### Tindakan Lanjut",
    ].join("\n");

    const out = renderMarkdown(md);
    expect(out).toContain("<h1>Nota Mesyuarat</h1>");
    expect(out).toContain("<h2>Keputusan Utama</h2>");
    expect(out).toContain("<h3>Tindakan Lanjut</h3>");
  });

  test("renders unordered lists (- item)", () => {
    const md = [
      "- Hadir: Hazman",
      "- Hadir: Ryan",
      "- Hadir: Amir",
    ].join("\n");

    const out = renderMarkdown(md);
    expect(out).toBe("<ul><li>Hadir: Hazman</li><li>Hadir: Ryan</li><li>Hadir: Amir</li></ul>");
  });

  test("renders tables with header and delimiter", () => {
    const md = [
      "| Perkara | Status | Tarikh |",
      "| --- | :---: | ---: |",
      "| Pasang pintu pagar | Selesai | 2026-10-23 |",
      "| Wiring sensor | Dalam proses | 2026-10-25 |",
    ].join("\n");

    const out = renderMarkdown(md);
    expect(out).toContain("<table><thead><tr><th>Perkara</th><th>Status</th><th>Tarikh</th></tr></thead>");
    expect(out).toContain("<tbody><tr><td>Pasang pintu pagar</td><td>Selesai</td><td>2026-10-23</td></tr>");
    expect(out).toContain("<tr><td>Wiring sensor</td><td>Dalam proses</td><td>2026-10-25</td></tr></tbody></table>");
  });

  test("escapes HTML before rendering, preventing XSS", () => {
    const md = [
      "# Header <img src=x onerror=alert(1)>",
      "<script>alert(document.cookie)</script>",
      "- <b onclick='evil()'>Item</b>",
      "| <script>evil()</script> | col |",
      "| --- | --- |",
      "| <a href='javascript:alert(1)'>link</a> | val |",
    ].join("\n");

    const out = renderMarkdown(md);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b onclick");
    expect(out).not.toContain("<a href");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("supports bold inside headings, lists, table cells, and paragraphs", () => {
    const md = [
      "# **Penting**: Mesyuarat",
      "- **Tindakan**: Ryan perlu **sah**kan",
      "| **No** | **Nama** |",
      "| --- | --- |",
      "| 1 | **Amir** |",
      "",
      "Sila semak dokumen **dengan teliti**.",
    ].join("\n");

    const out = renderMarkdown(md);
    expect(out).toContain("<h1><strong>Penting</strong>: Mesyuarat</h1>");
    expect(out).toContain("<li><strong>Tindakan</strong>: Ryan perlu <strong>sah</strong>kan</li>");
    expect(out).toContain("<th><strong>No</strong></th><th><strong>Nama</strong></th>");
    expect(out).toContain("<td><strong>Amir</strong></td>");
    expect(out).toContain("<p>Sila semak dokumen <strong>dengan teliti</strong>.</p>");
  });

  test("preserves timestamps like [12:30] and separates paragraphs", () => {
    const md = [
      "Perenggan pertama.",
      "[12:30] Perbincangan bermula.",
      "",
      "Perenggan kedua.",
    ].join("\n");

    const out = renderMarkdown(md);
    expect(out).toContain("<p>Perenggan pertama.<br>[12:30] Perbincangan bermula.</p>");
    expect(out).toContain("<p>Perenggan kedua.</p>");
  });
});
