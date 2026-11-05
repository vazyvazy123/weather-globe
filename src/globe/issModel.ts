// The International Space Station as a small 3D model (metres, in the station's own frame: x forward along its path, y
// along the truss, z down toward the Earth), to the real station's proportions: the 107 m truss, its eight 70 m solar
// array wings (which turn about the truss to face the sun, so they are marked), the six radiators by the centre, and
// the pressurised modules end to end beneath the truss — Zvezda and Zarya aft, Unity, Destiny and Harmony forward, with
// Columbus and Kibo (and its exposed platform) to either side of Harmony, Tranquility off Unity, and Zvezda's own small
// arrays. Each vertex: position, normal, uv (for the cells, bands and struts the shader draws), material. Pure.

export const VERTEX_FLOATS = 9
export const ISS_MATERIAL = { truss: 0, array: 1, module: 2, radiator: 3, smallArray: 4, frame: 5, arrayFrame: 6 } as const
/** the arrays turn about the truss's axis, this far up (zenith side, −z) from the modules' (m) */
export const ARRAY_PIVOT_Z = -3.4

type V3 = readonly [number, number, number]
const CYLINDER_SIDES = 14

function vertex(out: number[], p: V3, n: V3, u: number, v: number, mat: number): void {
  out.push(p[0], p[1], p[2], n[0], n[1], n[2], u, v, mat)
}

/** a flat four-cornered face (corners in turn), as two triangles */
function quad(out: number[], c: readonly V3[], n: V3, uv: ReadonlyArray<readonly [number, number]>, mat: number): void {
  for (const k of [0, 1, 2, 0, 2, 3]) vertex(out, c[k], n, uv[k][0], uv[k][1], mat)
}

const UV: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]]

/** a box from one corner to the other, its faces' normals outward */
function box(out: number[], a: V3, b: V3, mat: number): void {
  const [x0, y0, z0] = a, [x1, y1, z1] = b
  quad(out, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], UV, mat)
  quad(out, [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], [0, 0, 1], UV, mat)
  quad(out, [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0], UV, mat)
  quad(out, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], UV, mat)
  quad(out, [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], [0, -1, 0], UV, mat)
  quad(out, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], UV, mat)
}

/** a cylinder along x or y, from one end to the other, round a centre line (its other two coordinates), with ends;
 *  u runs along it in metres (for the modules' bands) */
function cylinder(out: number[], axis: "x" | "y", from: number, to: number, r: number, c: readonly [number, number], mat: number): void {
  const at = (s: number, a: number, rr: number): V3 => {
    const p = rr * Math.cos(a), q = rr * Math.sin(a)
    return axis === "x" ? [s, c[0] + p, c[1] + q] : [c[0] + p, s, c[1] + q]
  }
  const nrm = (a: number): V3 => (axis === "x" ? [0, Math.cos(a), Math.sin(a)] : [Math.cos(a), 0, Math.sin(a)])
  const end = (s: number): V3 => (axis === "x" ? [s, c[0], c[1]] : [c[0], s, c[1]])
  const capN = (sign: number): V3 => (axis === "x" ? [sign, 0, 0] : [0, sign, 0])
  for (let k = 0; k < CYLINDER_SIDES; k++) {
    const a0 = (2 * Math.PI * k) / CYLINDER_SIDES, a1 = (2 * Math.PI * (k + 1)) / CYLINDER_SIDES
    const v0 = k / CYLINDER_SIDES, v1 = (k + 1) / CYLINDER_SIDES
    const p00 = at(from, a0, r), p10 = at(to, a0, r), p11 = at(to, a1, r), p01 = at(from, a1, r)
    vertex(out, p00, nrm(a0), from, v0, mat); vertex(out, p10, nrm(a0), to, v0, mat); vertex(out, p11, nrm(a1), to, v1, mat)
    vertex(out, p00, nrm(a0), from, v0, mat); vertex(out, p11, nrm(a1), to, v1, mat); vertex(out, p01, nrm(a1), from, v1, mat)
    // the ends
    vertex(out, end(from), capN(-1), from, 0.5, mat); vertex(out, p01, capN(-1), from, 0.5, mat); vertex(out, p00, capN(-1), from, 0.5, mat)
    vertex(out, end(to), capN(1), to, 0.5, mat); vertex(out, p10, capN(1), to, 0.5, mat); vertex(out, p11, capN(1), to, 0.5, mat)
  }
}

/** a solar array blanket, flat (as made, facing nadir), across y0..y1 and out along x from x0 to x1; u from the mast
 *  out, v across */
function blanket(out: number[], y0: number, y1: number, x0: number, x1: number): void {
  const z = ARRAY_PIVOT_Z
  quad(out, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], ISS_MATERIAL.array)
}

/** the station's mesh (VERTEX_FLOATS a vertex, three vertices a triangle) */
export function issMesh(): Float32Array {
  const out: number[] = [], M = ISS_MATERIAL, pz = ARRAY_PIVOT_Z
  // the truss, the length of the station
  box(out, [-1.3, -53.5, pz - 1.3], [1.3, 53.5, pz + 1.3], M.truss)
  for (const side of [-1, 1]) {
    // four array wings a side (two pairs), each two blankets either side of its mast
    for (const yc of [20, 29.5, 39.5, 49]) {
      const y0 = side * yc - 4.5, y1 = side * yc + 4.5
      blanket(out, Math.min(y0, y1), Math.max(y0, y1), 2, 35)
      blanket(out, Math.min(y0, y1), Math.max(y0, y1), -2, -35)
      box(out, [-35, side * yc - 0.25, pz - 0.25], [35, side * yc + 0.25, pz + 0.25], M.arrayFrame)
    }
    // the joints the arrays turn on
    for (const yj of [34.5, 24.8, 44.2]) box(out, [-2.1, Math.min(side * (yj - 0.7), side * (yj + 0.7)), pz - 1.9], [2.1, Math.max(side * (yj - 0.7), side * (yj + 0.7)), pz + 1.9], M.frame)
    // three radiators by the centre, reaching aft
    for (const [ya, yb] of [[7.5, 10.5], [11, 14], [14.5, 17.5]]) {
      const a = side * ya, b = side * yb
      box(out, [-17, Math.min(a, b), pz - 0.12], [-2.5, Math.max(a, b), pz + 0.12], M.radiator)
    }
    // Zvezda's own arrays
    const s0 = side * 2.6, s1 = side * 15.5
    box(out, [-27.5, Math.min(s0, s1), -0.1], [-24.5, Math.max(s0, s1), 0.1], M.smallArray)
  }
  // the modules, end to end beneath the truss: Zvezda, Zarya, Unity, Destiny, Harmony
  cylinder(out, "x", -30, -16.5, 2.15, [0, 0], M.module)
  cylinder(out, "x", -16.5, -3.5, 2.05, [0, 0], M.module)
  cylinder(out, "x", -3.5, 1.8, 2.2, [0, 0], M.module)
  cylinder(out, "x", 1.8, 10.3, 2.1, [0, 0], M.module)
  cylinder(out, "x", 10.3, 17.5, 2.2, [0, 0], M.module)
  // Columbus and Kibo either side of Harmony, Kibo's exposed platform beyond it, Tranquility off Unity
  cylinder(out, "y", 2.2, 9.2, 2.2, [14, 0], M.module)
  cylinder(out, "y", -13.2, -2.2, 2.2, [14, 0], M.module)
  box(out, [11.5, -18.5, -0.6], [16.5, -13.2, 0.9], M.frame)
  cylinder(out, "y", -9, -2.2, 2.2, [-1, 0], M.module)
  return Float32Array.from(out)
}
