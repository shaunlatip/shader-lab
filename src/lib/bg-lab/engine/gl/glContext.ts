// BG Lab — WebGL2 low-level helpers: program compile/cache, a fullscreen quad,
// textures, framebuffers, and external-source upload (with FLIP_Y so image/video
// rows land upright). Orientation convention used everywhere downstream:
//   v_uv = a_pos*0.5+0.5  → v_uv.y === 1 is the TOP of the output.
//   External uploads use UNPACK_FLIP_Y_WEBGL = true so a source's top row maps to
//   t=1 (upright). Intermediate FBO textures need no flipping (same convention on
//   read and write).

export const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 o;
void main(){ o = texture(u_tex, v_uv); }`;

export interface GLTexture {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export class GLContext {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private quad: WebGLVertexArrayObject;
  private quadBuf: WebGLBuffer;
  private programs = new Map<string, WebGLProgram>();
  private copyProg: WebGLProgram;

  constructor() {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      // alpha:false → the canvas has no alpha channel, so copying it to the 2D
      // target (drawImage) is always opaque. Backgrounds always fully cover the
      // frame, so we never need canvas transparency.
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error("webgl2-unavailable");
    this.canvas = canvas;
    this.gl = gl;

    // fullscreen quad (two triangles)
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quad = vao;
    this.quadBuf = buf;

    this.copyProg = this.program(COPY_FRAG);
  }

  /** Compile + cache a program for a fragment source (vertex is shared). */
  program(fragSrc: string): WebGLProgram {
    const hit = this.programs.get(fragSrc);
    if (hit) return hit;
    const gl = this.gl;
    const prog = gl.createProgram()!;
    const vs = this.shader(gl.VERTEX_SHADER, VERT_SRC);
    const fs = this.shader(gl.FRAGMENT_SHADER, fragSrc);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      throw new Error("gl-link-failed: " + log);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.programs.set(fragSrc, prog);
    return prog;
  }

  private shader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      throw new Error("gl-compile-failed: " + log + "\n" + src);
    }
    return sh;
  }

  createTexture(w: number, h: number): GLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  /** Upload an external source (image/video/canvas) into a texture, FLIP_Y so it's upright. */
  uploadExternal(target: GLTexture, src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /** Run a fragment program, sampling `read` textures into the bound `dst` (or screen if null). */
  pass(
    prog: WebGLProgram,
    dst: GLTexture | null,
    reads: { name: string; tex: WebGLTexture }[],
    setUniforms?: (gl: WebGL2RenderingContext, prog: WebGLProgram) => void,
    dims?: { w: number; h: number },
  ) {
    const gl = this.gl;
    const w = dst ? dst.w : dims!.w;
    const h = dst ? dst.h : dims!.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    reads.forEach((r, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, r.tex);
      const loc = gl.getUniformLocation(prog, r.name);
      if (loc) gl.uniform1i(loc, i);
    });
    setUniforms?.(gl, prog);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Blit a texture to the default framebuffer (so the canvas shows it upright). */
  present(src: GLTexture) {
    this.pass(this.copyProg, null, [{ name: "u_tex", tex: src.tex }], undefined, { w: src.w, h: src.h });
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  dispose() {
    const gl = this.gl;
    this.programs.forEach((p) => gl.deleteProgram(p));
    this.programs.clear();
    gl.deleteVertexArray(this.quad);
    gl.deleteBuffer(this.quadBuf);
  }
}
