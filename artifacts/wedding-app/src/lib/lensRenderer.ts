/** Event-driven refractive glass. Static <img> remains the fallback at all times. */
export type LensController = { setVision(value: boolean): void; setPaused(value: boolean): void; destroy(): void };

const vertex = `attribute vec2 position; varying vec2 uv;
void main(){ uv=position*.5+.5; gl_Position=vec4(position,0.,1.); }`;
const fragment = `precision mediump float;
varying vec2 uv; uniform sampler2D spaceImage; uniform sampler2D visionImage;
uniform vec2 pointer; uniform float reveal; uniform float bend;
vec3 scene(vec2 p){
  vec2 covered=vec2((p.x-.5)*.6666667+.5,1.-p.y);
  float wipe=smoothstep(distance(p,vec2(.5))-.09,distance(p,vec2(.5))+.09,reveal*.84);
  return mix(texture2D(spaceImage,covered).rgb,texture2D(visionImage,covered).rgb,wipe);
}
void main(){
  vec2 v=uv-.5; float r=length(v); vec2 normal=normalize(v+vec2(.0001));
  float rim=smoothstep(.33,.5,r);
  vec2 p=.5+v*(1.-.10*rim);
  vec2 mouse=p-pointer;
  p-=mouse*exp(-dot(mouse,mouse)*28.)*.10*bend;
  float chroma=.004*rim;
  vec3 c=vec3(scene(p+normal*chroma).r,scene(p).g,scene(p-normal*chroma).b);
  float edge=pow(max(0.,r*2.),18.);
  c+=vec3(.45,.75,.87)*edge*.2;
  gl_FragColor=vec4(c,1.);
}`;

export async function mountLens(canvas: HTMLCanvasElement): Promise<LensController | null> {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = matchMedia("(pointer: coarse)");
  if (reduced.matches || coarse.matches) return null;
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power", preserveDrawingBuffer: false });
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  const textures: WebGLTexture[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let destroyed = false;
  let frame = 0;
  let visible = true;
  let paused = false;
  let desired = 0;
  let current = 0;
  let last = 0;
  let pointerX = .5;
  let pointerY = .5;
  function cleanupGpu() {
    textures.forEach(t => gl!.deleteTexture(t)); shaders.forEach(s => gl!.deleteShader(s));
    if (buffer) gl!.deleteBuffer(buffer); if (program) gl!.deleteProgram(program);
    canvas.style.opacity = "0";
  }
  try {
    function compile(type: number, source: string) {
      const shader = gl!.createShader(type); if (!shader) throw Error("Shader unavailable");
      shaders.push(shader); gl!.shaderSource(shader, source); gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw Error("Lens shader unavailable");
      return shader;
    }
    program = gl.createProgram(); if (!program) throw Error("Lens unavailable");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error("Lens link unavailable");
    const images = await Promise.all(["/brand/lens-venue-800.webp", "/brand/lens-vision-800.webp"].map(src => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
    })));
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    images.forEach((image, index) => {
      const texture = gl.createTexture(); if (!texture) throw Error("Lens texture unavailable");
      textures.push(texture); gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      gl.uniform1i(gl.getUniformLocation(program!, index ? "visionImage" : "spaceImage"), index);
    });
    const pointerLocation = gl.getUniformLocation(program, "pointer");
    const revealLocation = gl.getUniformLocation(program, "reveal");
    const bendLocation = gl.getUniformLocation(program, "bend");
    function draw(now: number) {
      frame = 0;
      if (destroyed || !visible || document.hidden || gl!.isContextLost()) return;
      const elapsed = Math.min(50, now - (last || now - 16)); last = now;
      current = paused || reduced.matches ? desired : current + (desired - current) * Math.min(1, elapsed / 100);
      const size = Math.min(1100, Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 1.5)));
      if (size < 1) return;
      if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
      gl!.viewport(0, 0, size, size); gl!.uniform2f(pointerLocation, pointerX, pointerY);
      gl!.uniform1f(revealLocation, current); gl!.uniform1f(bendLocation, paused || reduced.matches ? 0 : 1);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6); canvas.style.opacity = "1";
      if (Math.abs(desired - current) > .001) frame = requestAnimationFrame(draw);
    }
    function schedule() { if (!frame && !destroyed) frame = requestAnimationFrame(draw); }
    function move(event: PointerEvent) {
      if (paused || reduced.matches) return;
      const bounds = canvas.getBoundingClientRect();
      pointerX = (event.clientX - bounds.left) / bounds.width; pointerY = 1 - (event.clientY - bounds.top) / bounds.height;
      schedule();
    }
    function leave() { pointerX = pointerY = .5; schedule(); }
    function visibility() { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else schedule(); }
    function contextLost() { canvas.style.opacity = "0"; cancelAnimationFrame(frame); frame = 0; }
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; if (visible) schedule(); else { cancelAnimationFrame(frame); frame = 0; } });
    const resize = new ResizeObserver(schedule);
    observer.observe(canvas); resize.observe(canvas);
    canvas.addEventListener("pointermove", move, { passive: true }); canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("webglcontextlost", contextLost); document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", schedule); schedule();
    return {
      setVision(value) { desired = value ? 1 : 0; schedule(); },
      setPaused(value) { paused = value; schedule(); },
      destroy() {
        destroyed = true; cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect();
        canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerleave", leave); canvas.removeEventListener("webglcontextlost", contextLost);
        document.removeEventListener("visibilitychange", visibility); reduced.removeEventListener("change", schedule); cleanupGpu();
      },
    };
  } catch { cleanupGpu(); return null; }
}
