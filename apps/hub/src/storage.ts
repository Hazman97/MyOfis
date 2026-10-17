import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * File storage for run logs, screenshots and artifacts. Keys are forward-slash
 * paths like `runs/<run_id>.ndjson`. Kept behind an interface so it can move to R2.
 */
export interface Storage {
  put(key: string, data: string | Uint8Array): Promise<void>;
  append(key: string, data: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export class LocalStorage implements Storage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  #path(key: string): string {
    if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.includes("..")) throw new Error(`invalid storage key: ${key}`);
    const full = resolve(join(this.#root, key));
    if (!full.startsWith(this.#root + sep)) throw new Error(`storage key escapes root: ${key}`);
    return full;
  }

  async put(key: string, data: string | Uint8Array): Promise<void> {
    const p = this.#path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async append(key: string, data: string): Promise<void> {
    const p = this.#path(key);
    await mkdir(dirname(p), { recursive: true });
    await appendFile(p, data);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.#path(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}
