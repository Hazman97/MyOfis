/**
 * Pure, lightweight Markdown renderer for documents and meeting notes.
 * Escapes HTML first for complete safety, then renders headings, lists, bold, tables, and paragraphs.
 * No external dependencies.
 */

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}

export function formatInline(text: string): string {
  return text.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((c) => c.trim());
}

function isTableDelimiter(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/**
 * Render Markdown to sanitized HTML without external libraries.
 * HTML is escaped first so raw tags cannot execute.
 */
export function renderMarkdown(input: string): string {
  if (!input || !input.trim()) return "";
  const safe = escapeHtml(input);
  const lines = safe.split(/\r?\n/);
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Heading: #, ##, ###
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = formatInline(headingMatch[2]!.trim());
      blocks.push(`<h${level}>${text}</h${level}>`);
      i++;
      continue;
    }

    // Table: header line with | followed by delimiter row
    if (line.includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1]!)) {
      const headerLine = line;
      i += 2; // skip header and delimiter
      const bodyLines: string[] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        bodyLines.push(lines[i]!);
        i++;
      }
      const headerCells = splitTableRow(headerLine).map((c) => `<th>${formatInline(c)}</th>`).join("");
      const thead = `<thead><tr>${headerCells}</tr></thead>`;
      const bodyRows = bodyLines
        .map((r) => `<tr>${splitTableRow(r).map((c) => `<td>${formatInline(c)}</td>`).join("")}</tr>`)
        .join("");
      const tbody = `<tbody>${bodyRows}</tbody>`;
      blocks.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Unordered List: - item
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const itemMatch = lines[i]!.match(/^\s*-\s+(.*)$/);
        if (!itemMatch) break;
        items.push(`<li>${formatInline(itemMatch[1]!.trim())}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Paragraph: collect lines until blank line, heading, list, or table
    const pLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i]!;
      if (!cur.trim()) break;
      if (cur.match(/^#{1,3}\s+/)) break;
      if (cur.match(/^\s*-\s+/)) break;
      if (cur.includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1]!)) break;
      pLines.push(formatInline(cur.trim()));
      i++;
    }
    if (pLines.length > 0) {
      blocks.push(`<p>${pLines.join("<br>")}</p>`);
    }
  }

  return blocks.join("\n");
}
