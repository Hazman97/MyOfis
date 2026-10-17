import { z } from "zod";

/**
 * Skills in the agentskills.io format (the same one Hermes Agent uses): a
 * folder `skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`,
 * optional `version`, `metadata`) followed by Markdown instructions.
 * Agents propose skills; the owner approves them before they are saved.
 */
export const SkillName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "lowercase letters, digits and dashes, up to 64 characters");

export const MAX_SKILL_CHARS = 20_000;

export interface ParsedSkill {
  name: string;
  description: string;
  version: string | null;
  body: string;
}

/** Read the frontmatter we need (top-level `key: value` scalars). Throws with a readable reason. */
export function parseSkill(md: string): ParsedSkill {
  const m = md.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error("SKILL.md must start with a --- frontmatter block (name, description)");
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) fields[kv[1]!] = kv[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  const name = SkillName.safeParse(fields.name);
  if (!name.success) throw new Error(`frontmatter "name" is missing or invalid (${name.error.issues[0]?.message})`);
  const description = fields.description ?? "";
  if (description.length < 10 || description.length > 1024) throw new Error('frontmatter "description" must say when to use the skill (10-1024 characters)');
  if (md.length > MAX_SKILL_CHARS) throw new Error(`SKILL.md is too long (${md.length}/${MAX_SKILL_CHARS} characters)`);
  return { name: name.data, description, version: fields.version || null, body: m[2]!.trim() };
}

export interface SkillSummary {
  name: string;
  description: string;
}
