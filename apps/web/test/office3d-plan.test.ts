import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseOfficeMap, type TiledMap } from "../src/office/map/tmj.ts";
import { officePlan } from "../src/office/scene3d/plan.ts";

const map = JSON.parse(readFileSync(join(import.meta.dir, "../../../maps/office.tmj"), "utf8")) as TiledMap;
const layout = parseOfficeMap(map);
const plan = officePlan(map, layout);

test("the 3D plan builds furniture exactly on the blocked cells, never on a walkable one", () => {
  const covered = new Set<number>();
  for (const f of plan.furniture)
    for (let y = f.y; y < f.y + f.h; y++)
      for (let x = f.x; x < f.x + f.w; x++) {
        const i = y * layout.width + x;
        // a piece's bounding box may include a free cell only for L-shapes; this map has none
        expect(layout.blocked[i]).toBe(1);
        covered.add(i);
      }
  const wall = new Set(plan.walls.map((w) => w.y * layout.width + w.x));
  // every blocked cell is either wall or furniture
  layout.blocked.forEach((b, i) => b && expect(wall.has(i) || covered.has(i)).toBe(true));
});

test("eight numbered desks facing their chairs, and the rooms get their furniture", () => {
  const desks = plan.furniture.filter((f) => f.kind === "desk");
  expect(desks.map((d) => d.desk)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(desks.every((d) => d.front === "down")).toBe(true);
  const kinds = new Set(plan.furniture.map((f) => f.kind));
  for (const k of ["exec_desk", "meeting_table", "counter", "sofa", "pantry_table", "bookshelf", "rack", "cabinet", "planter"]) expect(kinds.has(k as never)).toBe(true);
  // the sofa is behind the pantry seats, the coffee table in front of them
  const sofa = plan.furniture.find((f) => f.kind === "sofa")!;
  const seats = layout.places.filter((p) => p.id.startsWith("sofa-"));
  expect(seats.every((s) => s.ty === sofa.y + sofa.h)).toBe(true);
  expect(plan.chairs.filter((c) => c.id.startsWith("desk-"))).toHaveLength(8);
});

test("back walls stand tall, the rest are low so the camera sees in", () => {
  expect(plan.walls.filter((w) => w.tall).every((w) => w.y < 2 || w.x === 0)).toBe(true);
  expect(plan.walls.some((w) => !w.tall)).toBe(true);
  expect(plan.zones.find((z) => z.zone === "pantry")).toMatchObject({ x: 28, z: 12, w: 11, d: 11 });
});
