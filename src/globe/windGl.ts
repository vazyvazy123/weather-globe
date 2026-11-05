// The wind drawn on a canvas of its own, over the globe's (WebGL2): each trail segment a thin quad — instanced, its four
// corners made from the segment's two ends — smoothed at its edges, thinning and fading from the trail's bright head to
// its tail, and coloured by the wind's speed: soft blue-white for most wind, gold, orange and rose only in a gale. Being its own canvas, the wind can move thirty
// times a second without the globe being drawn again.
import { MAX_PARTICLES, SEGMENTS_PER_TRAIL, SEG_FLOATS } from "./windParticles"

const VERT = `#version 300 es
layout(location = 0) in vec4 a_seg;   // x0, y0, x1, y1: device px, y down
layout(location = 1) in vec3 a_look;  // opacity, the wind's speed (m/s), the place along the trail (0 at its head)
uniform vec2 u_size;
uniform float u_half;                 // half the line's width at a trail's head, device px
out float v_across;
out float v_half;
out float v_alpha;
out float v_speed;
void main() {
  float along = float(gl_VertexID >> 1), side = float(gl_VertexID & 1) * 2.0 - 1.0;
  vec2 d = a_seg.zw - a_seg.xy;
  float len = length(d);
  vec2 t = len > 1e-3 ? d / len : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
  // the trail thins toward its tail; a pixel more each side for the smoothed edge
  float hw = u_half * (1.0 - 0.65 * a_look.z), w = hw + 1.0;
  vec2 p = mix(a_seg.xy, a_seg.zw, along) + n * side * w;
  v_across = side * w;
  v_half = hw;
  v_alpha = a_look.x;
  v_speed = a_look.y;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision mediump float;
in float v_across;
in float v_half;
in float v_alpha;
in float v_speed;
out vec4 outColor;
// m/s → colour: soft blue-white for most wind, warming to gold, orange and rose only in a gale
vec3 palette(float s) {
  vec3 c = mix(vec3(0.70, 0.82, 1.0), vec3(0.95, 0.97, 1.0), smoothstep(3.0, 12.0, s));
  c = mix(c, vec3(1.0, 0.84, 0.48), smoothstep(14.0, 19.0, s));
  c = mix(c, vec3(1.0, 0.58, 0.30), smoothstep(19.0, 25.0, s));
  return mix(c, vec3(1.0, 0.36, 0.52), smoothstep(25.0, 33.0, s));
}
void main() {
  // the share of the pixel the line covers (a line thinner than a pixel covers less of it)
  float edge = clamp(v_half + 0.5 - abs(v_across), 0.0, 1.0);
  float a = v_alpha * edge * (0.22 + 0.5 * smoothstep(1.0, 14.0, v_speed));
  outColor = vec4(palette(v_speed) * a, a);
}`

const MAX_SEGMENTS = MAX_PARTICLES * SEGMENTS_PER_TRAIL

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s
  console.warn("[wind] shader did not compile:", gl.getShaderInfoLog(s))
  gl.deleteShader(s)
  return null
}

export class WindGl {
  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly prog: WebGLProgram,
    private readonly vao: WebGLVertexArrayObject,
    private readonly buf: WebGLBuffer,
    private readonly loc: { size: WebGLUniformLocation | null; half: WebGLUniformLocation | null },
  ) {}

  /** null where WebGL2 is unavailable */
  static create(canvas: HTMLCanvasElement): WindGl | null {
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" })
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
      console.warn("[wind] program did not link:", gl.getProgramInfoLog(prog))
      return null
    }
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, MAX_SEGMENTS * SEG_FLOATS * 4, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, SEG_FLOATS * 4, 0)
    gl.vertexAttribDivisor(0, 1)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, SEG_FLOATS * 4, 16)
    gl.vertexAttribDivisor(1, 1)
    gl.bindVertexArray(null)
    return new WindGl(gl, prog, vao, buf, { size: gl.getUniformLocation(prog, "u_size"), half: gl.getUniformLocation(prog, "u_half") })
  }

  /** Draws `count` segments (SEG_FLOATS each) over a cleared canvas `width` × `height` device px, lines `lineW` wide. */
  draw(segs: Float32Array, count: number, width: number, height: number, lineW: number): void {
    const gl = this.gl
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const n = Math.min(count, MAX_SEGMENTS)
    if (n <= 0) return
    gl.useProgram(this.prog)
    gl.uniform2f(this.loc.size, width, height)
    gl.uniform1f(this.loc.half, lineW / 2)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, segs, 0, n * SEG_FLOATS)
    gl.bindVertexArray(this.vao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
    gl.bindVertexArray(null)
  }

  /** Frees the GPU objects (the context goes with its canvas). */
  dispose(): void {
    const gl = this.gl
    gl.deleteBuffer(this.buf)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.prog)
  }
}
