// The ISS drawn in 3D (WebGL2) on a small canvas of its own over the globe: the station's model (issModel.ts) seen as the
// globe's camera sees it — straight down the line of sight, orthographic like the globe — in its real attitude as it
// flies (orbit.ts issFrame), its solar arrays turned about the truss to face the sun as the real ones are. Lit by the
// sun (gold-copper array cells with a glint, white blanketed modules, a silver truss with its struts, white radiators)
// and from below by a soft blue Earthshine; in the Earth's shadow only the Earthshine is left. Drawn again only when the
// station or the camera moves.
import { ARRAY_PIVOT_Z, ISS_MATERIAL, VERTEX_FLOATS, issMesh } from "./issModel"

/** the canvas's side (CSS px): room for the station at its largest, turned any way */
export const ISS_CANVAS_PX = 176

const VERT = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in float a_mat;
uniform mat3 u_body;    // the station's frame → the camera's (columns: forward, truss, nadir)
uniform float u_turn;   // the arrays' turn about the truss (rad)
uniform float u_scale;  // clip units per metre
out vec3 v_n;
out vec2 v_uv;
out float v_mat;
void main() {
  vec3 p = a_pos, n = a_nrm;
  if (abs(a_mat - ${ISS_MATERIAL.array}.0) < 0.5 || abs(a_mat - ${ISS_MATERIAL.arrayFrame}.0) < 0.5) {
    float c = cos(u_turn), s = sin(u_turn);
    vec3 q = p - vec3(0.0, 0.0, ${ARRAY_PIVOT_Z});
    p = vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c) + vec3(0.0, 0.0, ${ARRAY_PIVOT_Z});
    n = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  }
  vec3 cp = u_body * p;
  v_n = u_body * n;
  v_uv = a_uv;
  v_mat = a_mat;
  gl_Position = vec4(cp.xy * u_scale, -cp.z / 80.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec3 v_n;
in vec2 v_uv;
in float v_mat;
uniform vec3 u_sun;    // toward the sun, camera space
uniform vec3 u_down;   // toward the Earth, camera space
uniform float u_lit;   // 1 in sunlight, 0 in the Earth's shadow
out vec4 outColor;
// 1 inside a grid's cells, falling to 0 on its lines (as wide as a pixel, at any size)
float cells(vec2 uv, vec2 count) {
  vec2 f = fract(uv * count), w = fwidth(uv * count) * 1.2;
  vec2 l = smoothstep(vec2(0.0), w, f) * smoothstep(vec2(0.0), w, 1.0 - f);
  return min(l.x, l.y);
}
void main() {
  vec3 n = normalize(v_n);
  // two-sided: the side facing the viewer
  bool front = n.z >= 0.0;
  if (!front) n = -n;
  int m = int(v_mat + 0.5);
  vec3 base;
  float spec, shine;
  if (m == ${ISS_MATERIAL.array}) {
    // the sun-facing side is cells (gold-copper, the grid darker); the back is a pale weave
    if (front) { base = mix(vec3(0.26, 0.15, 0.06), vec3(0.82, 0.57, 0.24), cells(v_uv, vec2(16.0, 2.0))); spec = 0.9; shine = 80.0; }
    else { base = vec3(0.62, 0.62, 0.58); spec = 0.15; shine = 10.0; }
  } else if (m == ${ISS_MATERIAL.module}) {
    // white blankets, ringed every couple of metres
    float ring = smoothstep(0.0, 0.06, abs(fract(v_uv.x * 0.55) - 0.5) - 0.44);
    base = mix(vec3(0.70, 0.69, 0.66), vec3(0.95, 0.94, 0.90), ring); spec = 0.22; shine = 14.0;
  } else if (m == ${ISS_MATERIAL.truss}) {
    // the truss's struts
    float strut = smoothstep(0.0, 0.08, abs(fract(v_uv.y * 42.0) - 0.5) - 0.3);
    base = mix(vec3(0.42, 0.44, 0.48), vec3(0.76, 0.78, 0.82), strut); spec = 0.6; shine = 34.0;
  } else if (m == ${ISS_MATERIAL.radiator}) {
    base = mix(vec3(0.80, 0.82, 0.86), vec3(0.97, 0.97, 0.99), cells(v_uv, vec2(1.0, 6.0))); spec = 0.35; shine = 20.0;
  } else if (m == ${ISS_MATERIAL.smallArray}) {
    base = mix(vec3(0.05, 0.07, 0.14), vec3(0.16, 0.22, 0.42), cells(v_uv, vec2(2.0, 8.0))); spec = 0.7; shine = 60.0;
  } else {
    base = vec3(0.55, 0.57, 0.62); spec = 0.4; shine = 24.0;
  }
  vec3 L = normalize(u_sun), V = vec3(0.0, 0.0, 1.0), H = normalize(L + V);
  float diff = max(dot(n, L), 0.0) * u_lit;
  float glint = pow(max(dot(n, H), 0.0), shine) * spec * u_lit;
  float earth = max(dot(n, normalize(u_down)), 0.0);
  // in the Earth's shadow a cool, faint glow stays, so the station still reads against the night
  vec3 ambient = mix(vec3(0.16, 0.19, 0.26), vec3(0.07, 0.08, 0.10), u_lit);
  vec3 col = base * (ambient + vec3(1.0, 0.97, 0.92) * diff * 1.15 + vec3(0.10, 0.16, 0.26) * earth) + vec3(1.0, 0.95, 0.86) * glint;
  outColor = vec4(col, 1.0);
}`

/** what a drawing needs: the station's axes, the sun's direction in the camera's frame (x right, y up, z toward the
 *  viewer), whether it is in sunlight, and its size on screen */
export interface IssView {
  readonly forward: readonly [number, number, number]
  readonly truss: readonly [number, number, number]
  readonly nadir: readonly [number, number, number]
  readonly sun: readonly [number, number, number]
  readonly lit: boolean
  /** CSS px a metre */
  readonly pxPerM: number
  readonly dpr: number
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s
  console.warn("[iss] shader did not compile:", gl.getShaderInfoLog(s))
  gl.deleteShader(s)
  return null
}

export class IssGl {
  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly prog: WebGLProgram,
    private readonly vao: WebGLVertexArrayObject,
    private readonly buf: WebGLBuffer,
    private readonly count: number,
    private readonly loc: Record<"body" | "turn" | "scale" | "sun" | "down" | "lit", WebGLUniformLocation | null>,
  ) {}

  /** null where WebGL2 is unavailable (the drawn station stands in) */
  static create(canvas: HTMLCanvasElement): IssGl | null {
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false, powerPreference: "low-power" })
    if (!gl) return null
    const vs = compile(gl, gl.VERTEX_SHADER, VERT), fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    const prog = gl.createProgram(), vao = gl.createVertexArray(), buf = gl.createBuffer()
    if (!vs || !fs || !prog || !vao || !buf) return null
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[iss] program did not link:", gl.getProgramInfoLog(prog))
      return null
    }
    const mesh = issMesh(), stride = VERTEX_FLOATS * 4
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW)
    for (const [loc, size, off] of [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 1, 32]] as const) {
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off)
    }
    gl.bindVertexArray(null)
    const u = (n: string) => gl.getUniformLocation(prog, n)
    return new IssGl(canvas, gl, prog, vao, buf, mesh.length / VERTEX_FLOATS,
      { body: u("u_body"), turn: u("u_turn"), scale: u("u_scale"), sun: u("u_sun"), down: u("u_down"), lit: u("u_lit") })
  }

  draw(v: IssView): void {
    const gl = this.gl, side = Math.round(ISS_CANVAS_PX * v.dpr)
    if (this.canvas.width !== side) { this.canvas.width = side; this.canvas.height = side }
    gl.viewport(0, 0, side, side)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.useProgram(this.prog)
    const { forward: f, truss: t, nadir: n, sun: s } = v
    gl.uniformMatrix3fv(this.loc.body, false, [f[0], f[1], f[2], t[0], t[1], t[2], n[0], n[1], n[2]])
    // the arrays face the sun: their normal (nadir as made) turned about the truss toward the sun's own direction there
    gl.uniform1f(this.loc.turn, Math.atan2(f[0] * s[0] + f[1] * s[1] + f[2] * s[2], n[0] * s[0] + n[1] * s[1] + n[2] * s[2]))
    gl.uniform1f(this.loc.scale, v.pxPerM / (ISS_CANVAS_PX / 2))
    gl.uniform3f(this.loc.sun, s[0], s[1], s[2])
    gl.uniform3f(this.loc.down, n[0], n[1], n[2])
    gl.uniform1f(this.loc.lit, v.lit ? 1 : 0)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, this.count)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteBuffer(this.buf)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.prog)
  }
}
