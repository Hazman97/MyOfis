import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { freshFetch, memoryContentProblem, parseSkill } from "@agent-office/shared";
import { HttpError } from "./repo.ts";

/**
 * Popular public skills (owner request: "Browse" on the Skills page). Two catalogues in the same
 * SKILL.md format: Anthropic's official skills and Nous Research's Hermes Agent skills. The list
 * (name, description, licence) is built from GitHub and cached for a day; installing copies the
 * SKILL.md only (scripts or reference files next to it are not copied, and the UI says so).
 */
export interface CatalogSource {
  id: "anthropic" | "hermes";
  name: string;
  repo: string;
  branch: string;
  /** Folders whose sub-folders hold a SKILL.md. */
  roots: string[];
  /** Licence when a skill has none of its own. */
  license: string;
}

export const CATALOG_SOURCES: CatalogSource[] = [
  { id: "anthropic", name: "Anthropic skills", repo: "anthropics/skills", branch: "main", roots: ["skills/"], license: "see LICENSE.txt" },
  { id: "hermes", name: "Hermes Agent skills", repo: "NousResearch/hermes-agent", branch: "main", roots: ["skills/", "optional-skills/"], license: "MIT" },
];

export interface CatalogSkill {
  source: CatalogSource["id"];
  /** Path of the SKILL.md in the repo. */
  path: string;
  name: string;
  description: string;
  category: string;
  license: string;
  /** False for source-available licences that limit use (e.g. Anthropic's document skills). */
  open_license: boolean;
  /** The skill folder has other files (scripts, references) that are not installed. */
  has_extra_files: boolean;
  url: string;
}

interface CacheFile {
  at: number;
  skills: CatalogSkill[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 8;

const raw = (s: CatalogSource, path: string) => `https://raw.githubusercontent.com/${s.repo}/${s.branch}/${path}`;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export class SkillCatalog {
  #building: Promise<CatalogSkill[]> | null = null;

  constructor(private readonly cachePath: string) {}

  #read(): CacheFile | null {
    try {
      return existsSync(this.cachePath) ? (JSON.parse(readFileSync(this.cachePath, "utf8")) as CacheFile) : null;
    } catch {
      return null;
    }
  }

  async list(refresh = false): Promise<{ skills: CatalogSkill[]; updated_at: string | null }> {
    const cached = this.#read();
    if (cached && !refresh && Date.now() - cached.at < DAY_MS) return { skills: cached.skills, updated_at: new Date(cached.at).toISOString() };
    this.#building ??= this.#build().finally(() => (this.#building = null));
    try {
      const skills = await this.#building;
      return { skills, updated_at: new Date().toISOString() };
    } catch (err) {
      // GitHub down or rate-limited: an old list is better than none
      if (cached) return { skills: cached.skills, updated_at: new Date(cached.at).toISOString() };
      throw new HttpError(400, `could not load the skill catalogue: ${(err as Error).message}`);
    }
  }

  async #build(): Promise<CatalogSkill[]> {
    const all: CatalogSkill[] = [];
    for (const s of CATALOG_SOURCES) {
      const res = await freshFetch(`https://api.github.com/repos/${s.repo}/git/trees/${s.branch}?recursive=1`, {
        timeoutMs: 30_000,
        headers: { accept: "application/vnd.github+json", "user-agent": "AgentOffice" },
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${s.repo}`);
      const tree = ((await res.json()) as { tree?: { path: string; type: string }[] }).tree ?? [];
      const files = new Set(tree.filter((t) => t.type === "blob").map((t) => t.path));
      const skillFiles = [...files].filter((p) => p.endsWith("/SKILL.md") && s.roots.some((r) => p.startsWith(r)));
      const found = await mapLimit(skillFiles, CONCURRENCY, async (path): Promise<CatalogSkill | null> => {
        const dir = path.slice(0, -"/SKILL.md".length);
        try {
          const md = await (await freshFetch(raw(s, path), { timeoutMs: 20_000 })).text();
          const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
          let license = fm.match(/^license:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? s.license;
          let open = true;
          if (files.has(`${dir}/LICENSE.txt`)) {
            const text = await (await freshFetch(raw(s, `${dir}/LICENSE.txt`), { timeoutMs: 20_000 })).text();
            open = /apache license|mit license|bsd/i.test(text);
            license = /apache license/i.test(text) ? "Apache-2.0" : /mit license/i.test(text) ? "MIT" : "Source-available (limited use)";
          }
          const p = parseSkill(md.length > 20_000 ? `${md.slice(0, 19_000)}\n` : md);
          const rel = dir.split("/");
          return {
            source: s.id,
            path,
            name: p.name,
            description: p.description,
            category: rel.length > 2 ? rel[rel.length - 2]! : s.id === "anthropic" ? "general" : rel[0]!,
            license,
            open_license: open,
            has_extra_files: [...files].some((f) => f.startsWith(`${dir}/`) && f !== path && !/LICENSE/i.test(f)),
            url: `https://github.com/${s.repo}/tree/${s.branch}/${dir}`,
          };
        } catch {
          return null; // unparseable or unreachable skills are simply not listed
        }
      });
      all.push(...found.filter((x): x is CatalogSkill => !!x));
    }
    mkdirSync(dirname(this.cachePath), { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify({ at: Date.now(), skills: all } satisfies CacheFile));
    return all;
  }

  /** Download one catalogue skill's SKILL.md, checked like any import. */
  async fetchSkill(source: string, path: string): Promise<{ content: string; warnings: string[] }> {
    const s = CATALOG_SOURCES.find((x) => x.id === source);
    const known = (await this.list()).skills.find((x) => x.source === source && x.path === path);
    if (!s || !known) throw new HttpError(404, "that skill is not in the catalogue");
    const res = await freshFetch(raw(s, path), { timeoutMs: 30_000 });
    if (!res.ok) throw new HttpError(400, `GitHub answered ${res.status}`);
    const content = await res.text();
    const warnings: string[] = [];
    const problem = memoryContentProblem(content);
    if (problem) warnings.push(problem);
    if (/\b(curl|wget|Invoke-WebRequest|rm -rf|del \/s)\b/i.test(content)) warnings.push("it tells the agent to run download/delete commands: read it before use");
    if (known.has_extra_files) warnings.push("its scripts/reference files were not installed; the agent only gets the SKILL.md");
    return { content, warnings };
  }
}
