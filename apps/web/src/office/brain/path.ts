import { js as EasyStar } from "easystarjs";
import type { OfficeLayout } from "../map/tmj.ts";

const FREE = 0;
const SEAT = 2;
const WALL = 1;

/**
 * Grid pathfinding on the map's collision layer (easystar, sync mode so it is
 * deterministic and testable). Seat tiles are walkable but cost more, so
 * characters walk around chairs unless a chair is where they are going.
 */
export class Pathfinder {
  #es = new EasyStar();
  readonly width: number;
  readonly height: number;
  #blocked: Uint8Array;

  constructor(layout: OfficeLayout) {
    this.width = layout.width;
    this.height = layout.height;
    this.#blocked = layout.blocked;
    const seats = new Set(layout.places.filter((p) => p.kind !== "spot").map((p) => p.ty * layout.width + p.tx));
    const grid: number[][] = [];
    for (let y = 0; y < layout.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < layout.width; x++) {
        const i = y * layout.width + x;
        row.push(layout.blocked[i] ? WALL : seats.has(i) ? SEAT : FREE);
      }
      grid.push(row);
    }
    this.#es.setGrid(grid);
    this.#es.setAcceptableTiles([FREE, SEAT]);
    this.#es.setTileCost(SEAT, 4);
    this.#es.enableSync();
    this.#es.setIterationsPerCalculation(Number.MAX_SAFE_INTEGER);
  }

  isFree(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && !this.#blocked[y * this.width + x];
  }

  /** Tile path including both ends, or null when unreachable. */
  find(fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number }[] | null {
    if (fromX === toX && fromY === toY) return [{ x: toX, y: toY }];
    if (!this.isFree(toX, toY)) return null;
    // start tiles can be blocked when a character stands somewhere odd (e.g. after a map edit): walk out from the nearest free tile
    const start = this.isFree(fromX, fromY) ? { x: fromX, y: fromY } : this.nearestFree(fromX, fromY);
    if (!start) return null;
    let result: { x: number; y: number }[] | null = null;
    this.#es.findPath(start.x, start.y, toX, toY, (p) => {
      result = p;
    });
    this.#es.calculate();
    return result;
  }

  nearestFree(x: number, y: number): { x: number; y: number } | null {
    for (let r = 1; r < Math.max(this.width, this.height); r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && this.isFree(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    return null;
  }
}
