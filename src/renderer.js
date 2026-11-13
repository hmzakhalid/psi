// Draws the room and the wavefunction. WebGL when available, a per-cell 2D fallback when not.
//
// The wave is uploaded as a 256 x 144 texture of (Re ψ, Im ψ). The shader rebuilds a smooth field
// from it with a Catmull-Rom filter, colours it by phase, and brightens it by amplitude.

import { W, H, N, WALL, BARRIER, RED, GREEN, GLASS, MESH } from './physics.js';

const TAU = Math.PI * 2;

// A cyclic palette for phase: cyan → violet → coral → gold → cyan. colour = A + B·cos(2π(t + D)).
const PALETTE = { a: [0.55, 0.52, 0.62], b: [-0.45, 0.36, 0.42], d: [-0.1, 0.1, -0.1] };
const paletteChannel = (phase, c) => PALETTE.a[c] + PALETTE.b[c] * Math.cos(TAU * (phase + PALETTE.d[c]));

// Bytes that mark special materials in the blue channel of the field texture.
const MESH_BYTE = 255, GLASS_BYTE = 110;

const VERTEX_SHADER = `
attribute vec2 corner;
varying vec2 uv;
void main() {
  uv = vec2(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;
varying vec2 uv;
uniform sampler2D uField;    // nearest: rg = companded (Re, Im)
uniform sampler2D uSoft;     // the same bytes, linear: b = mesh/glass, a = amplitude
uniform sampler2D uRoom;     // linear: r = wall, g = exit, b = red detector, a = barrier
uniform vec2 uGrid;
uniform float uTime, uLocked, uFlash;

vec3 palette(float t) {
  return vec3(${PALETTE.a}) + vec3(${PALETTE.b}) * cos(6.2831853 * (t + vec3(${PALETTE.d})));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// One cell of ψ. The bytes store sign(v)·sqrt(|v|) so faint parts of the wave keep their precision.
vec2 cell(vec2 ij) {
  vec2 c = (texture2D(uField, (ij + 0.5) / uGrid).rg - 0.5019608) * 2.007874;
  return c * abs(c);
}
vec4 catmullRom(float f) {
  float f2 = f * f, f3 = f2 * f;
  return vec4(-0.5 * f3 + f2 - 0.5 * f, 1.5 * f3 - 2.5 * f2 + 1.0, -1.5 * f3 + 2.0 * f2 + 0.5 * f, 0.5 * f3 - 0.5 * f2);
}
vec2 row(float y, float x, vec4 w) {
  return cell(vec2(x - 1.0, y)) * w.x + cell(vec2(x, y)) * w.y + cell(vec2(x + 1.0, y)) * w.z + cell(vec2(x + 2.0, y)) * w.w;
}
// ψ at any point, reconstructed from the 16 nearest cells.
vec2 psi(vec2 p) {
  vec2 q = p * uGrid - 0.5, i = floor(q), f = q - i;
  vec4 wx = catmullRom(f.x), wy = catmullRom(f.y);
  return row(i.y - 1.0, i.x, wx) * wy.x + row(i.y, i.x, wx) * wy.y + row(i.y + 1.0, i.x, wx) * wy.z + row(i.y + 2.0, i.x, wx) * wy.w;
}
float density(vec2 p) { float a = texture2D(uSoft, p).a; return a * a; }

void main() {
  vec2 g = uv * uGrid, px = 1.0 / uGrid;
  vec4 room = texture2D(uRoom, uv);
  vec2 z = psi(uv);
  float d = dot(z, z);
  float phase = atan(z.y, z.x) / 6.2831853;

  // a soft halo from the density around this point
  float glow = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982 + 0.3;
    vec2 o = vec2(cos(a), sin(a));
    glow += density(uv + o * px * 2.5) * 0.8 + density(uv + o * px * 6.5) * 0.5;
  }
  glow /= 8.0;

  // empty space: deep navy with a faint grid
  vec3 col = mix(vec3(0.022, 0.026, 0.055), vec3(0.010, 0.012, 0.030), uv.y);
  vec2 line = abs(fract(g / 8.0) - 0.5);
  col += vec3(0.05, 0.07, 0.15) * smoothstep(0.46, 0.5, max(line.x, line.y)) * 0.30;

  float wall = smoothstep(0.35, 0.65, room.r);
  vec3 tint = palette(phase);
  float bright = pow(min(d, 1.0), 0.42);
  vec3 wave = tint * bright * 1.5 + mix(tint, vec3(0.35, 0.5, 1.0), 0.6) * pow(glow, 0.6) * 0.5;

  // mesh (dashed cyan) and glass (teal haze)
  float special = texture2D(uSoft, uv).b;
  col += vec3(0.22, 0.70, 0.95) * smoothstep(0.55, 0.9, special) * (0.22 + 0.55 * step(0.5, fract(g.y / 2.0 + uTime * 0.25)));
  col += vec3(0.07, 0.26, 0.30) * smoothstep(0.2, 0.43, special) * (1.0 - smoothstep(0.5, 0.6, special));

  // detectors and barriers
  float red = smoothstep(0.3, 0.7, room.b), green = smoothstep(0.3, 0.7, room.g), barrier = smoothstep(0.3, 0.7, room.a);
  float scan = 0.5 + 0.5 * sin(g.y * 1.4 - uTime * 5.0);
  col = mix(col, vec3(0.50, 0.045, 0.10) * (0.26 + 0.16 * scan), red * 0.9);
  float pulse = 0.5 + 0.5 * sin(uTime * 2.2 - g.x * 0.12);
  vec3 awake = vec3(0.06, 0.62, 0.36) * (0.30 + 0.14 * pulse);
  vec3 asleep = vec3(0.16, 0.18, 0.22) * (0.35 + 0.25 * step(0.5, fract((g.x + g.y) / 6.0)));
  col = mix(col, mix(awake, asleep, uLocked), green * 0.9);
  col += vec3(0.42, 0.30, 1.0) * barrier * (0.16 + 0.26 * step(0.5, fract(g.y / 3.0 + uTime * 0.4)));

  // the wave, a little hotter where a detector is drinking it
  col += wave * (1.0 - wall) * (1.0 + red * 0.6 + green * 0.4);

  // outlines
  float redEdge = smoothstep(0.08, 0.5, room.b) * (1.0 - smoothstep(0.5, 0.92, room.b));
  float greenEdge = smoothstep(0.08, 0.5, room.g) * (1.0 - smoothstep(0.5, 0.92, room.g));
  col += vec3(1.0, 0.22, 0.30) * redEdge * 0.75 + mix(vec3(0.25, 1.0, 0.6), vec3(0.4), uLocked) * greenEdge * 0.55;

  // walls, with an edge that catches the light of a nearby wave
  col = mix(col, vec3(0.070, 0.080, 0.130) + vec3(0.018) * hash(floor(g)), wall);
  float wallEdge = smoothstep(0.06, 0.5, room.r) * (1.0 - smoothstep(0.5, 0.94, room.r));
  col += (vec3(0.26, 0.36, 0.72) * 0.5 + tint * pow(glow, 0.5) * 1.3) * wallEdge;

  // vignette, flash, tone curve, grain
  vec2 c = uv - 0.5;
  col *= 1.0 - 0.55 * dot(c, c);
  col += uFlash * vec3(0.55, 0.65, 0.9);
  col = 1.0 - exp(-col * 1.7);
  col += (hash(g * 3.1 + uTime) - 0.5) * 0.014;
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Create the renderer on the stage's WebGL canvas.
 * Returns { draw, resize, usingWebGL }.
 */
export function createRenderer(canvas, { forceFallback = false } = {}) {
  const fieldBytes = new Uint8Array(N * 4);   // rg = ψ, b = mesh/glass, a = amplitude
  const roomBase = new Uint8Array(N * 4);     // the static room
  const roomBytes = new Uint8Array(N * 4);    // the room with scanners stamped in
  const special = new Uint8Array(N);
  let bakedVersion = -1;
  let exposure = 1e-3;                        // the density that maps to full brightness

  let gl = null, uniforms = {}, textures = {};
  let fallback = null;                        // { context, buffer, bufferContext, image }

  function initWebGL() {
    if (forceFallback) return false;
    try {
      gl = canvas.getContext('webgl', { antialias: false, alpha: false }) || canvas.getContext('experimental-webgl');
      if (!gl) return false;
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);

      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const corner = gl.getAttribLocation(program, 'corner');
      gl.enableVertexAttribArray(corner);
      gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

      for (const name of ['uField', 'uSoft', 'uRoom', 'uGrid', 'uTime', 'uLocked', 'uFlash']) {
        uniforms[name] = gl.getUniformLocation(program, name);
      }
      const makeTexture = (unit, filter) => {
        const texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        return texture;
      };
      textures = { field: makeTexture(0, gl.NEAREST), room: makeTexture(1, gl.LINEAR), soft: makeTexture(2, gl.LINEAR) };
      gl.uniform1i(uniforms.uField, 0);
      gl.uniform1i(uniforms.uRoom, 1);
      gl.uniform1i(uniforms.uSoft, 2);
      gl.uniform2f(uniforms.uGrid, W, H);
      return true;
    } catch (error) {
      console.warn('WebGL unavailable, using the plain renderer:', error);
      gl = null;
      return false;
    }
  }

  function initFallback() {
    // A canvas that has handed out a WebGL context cannot give a 2D one, so swap in a fresh canvas.
    const fresh = document.createElement('canvas');
    fresh.id = canvas.id;
    canvas.replaceWith(fresh);
    canvas = fresh;
    const buffer = document.createElement('canvas');
    buffer.width = W; buffer.height = H;
    const bufferContext = buffer.getContext('2d');
    fallback = { context: fresh.getContext('2d'), buffer, bufferContext, image: bufferContext.createImageData(W, H) };
  }

  /** Turn the room's layout into texture bytes. Runs once per room. */
  function bake(world) {
    const { kind } = world;
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const k = kind[i];
      roomBase[j] = k === WALL ? 255 : 0;
      roomBase[j + 1] = k === GREEN ? 255 : 0;
      roomBase[j + 2] = k === RED ? 255 : 0;
      roomBase[j + 3] = k === BARRIER ? 255 : 0;
      special[i] = k === MESH ? MESH_BYTE : k === GLASS ? GLASS_BYTE : 0;
    }
    bakedVersion = world.version;
    exposure = 1e-3;
  }

  function stampSweepers(world) {
    roomBytes.set(roomBase);
    for (const s of world.sweepers) {
      const x0 = Math.max(0, Math.floor(s.cx - s.w / 2)), x1 = Math.min(W, Math.floor(s.cx + s.w / 2));
      const y0 = Math.max(0, Math.floor(s.cy - s.h / 2)), y1 = Math.min(H, Math.floor(s.cy + s.h / 2));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) roomBytes[(y * W + x) * 4 + 2] = 255;
      }
    }
  }

  /** Pack ψ into bytes, with an exposure that follows the brightest part of the wave. */
  function packField(world, norm, dt) {
    const { R, I } = world;
    const target = Math.max(world.maxDensity || 0, norm * 1.5e-4, 1e-12);
    exposure += (target - exposure) * Math.min(1, dt * 7 + (target > exposure ? 0.5 : 0));
    const scale = 1 / Math.sqrt(exposure);
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      let re = R[i] * scale, im = I[i] * scale;
      re = re > 1 ? 1 : re < -1 ? -1 : re;
      im = im > 1 ? 1 : im < -1 ? -1 : im;
      fieldBytes[j] = 128 + 127 * (re < 0 ? -Math.sqrt(-re) : Math.sqrt(re));
      fieldBytes[j + 1] = 128 + 127 * (im < 0 ? -Math.sqrt(-im) : Math.sqrt(im));
      fieldBytes[j + 2] = special[i];
      fieldBytes[j + 3] = 255 * Math.min(1, Math.sqrt(re * re + im * im));
    }
  }

  function drawWebGL(roomChanged, view) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    for (const [unit, texture] of [[0, textures.field], [2, textures.soft]]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, fieldBytes);
    }
    if (roomChanged) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textures.room);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, roomBytes);
    }
    gl.uniform1f(uniforms.uTime, view.time % 1000);
    gl.uniform1f(uniforms.uLocked, view.locked ? 1 : 0);
    gl.uniform1f(uniforms.uFlash, view.flash);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** The same picture without WebGL: flatter, but everything that matters for play is there. */
  function drawFallback(view) {
    const pixels = fallback.image.data;
    const tone = v => 255 * (1 - Math.exp(-v * 1.7));
    for (let y = 0, j = 0; y < H; y++) {
      for (let x = 0; x < W; x++, j += 4) {
        const cr = (fieldBytes[j] - 128) / 127, ci = (fieldBytes[j + 1] - 128) / 127;
        const re = cr * Math.abs(cr), im = ci * Math.abs(ci);
        const bright = Math.sqrt(re * re + im * im) * 1.6;
        let r = 0.022, g = 0.026, b = 0.055;
        if (roomBytes[j + 2]) {
          const scan = 0.26 + 0.16 * (0.5 + 0.5 * Math.sin(y * 1.4 - view.time * 5));
          r = 0.5 * scan; g = 0.045 * scan; b = 0.1 * scan;
        } else if (roomBytes[j + 1]) {
          if (view.locked) { r = 0.06; g = 0.07; b = 0.085; } else {
            const pulse = 0.30 + 0.14 * (0.5 + 0.5 * Math.sin(view.time * 2.2 - x * 0.12));
            r = 0.06 * pulse; g = 0.62 * pulse; b = 0.36 * pulse;
          }
        }
        if (roomBytes[j + 3]) { r += 0.13; g += 0.09; b += 0.3; }
        if (fieldBytes[j + 2] === MESH_BYTE && (y & 1)) { r += 0.1; g += 0.3; b += 0.4; }
        if (bright > 0.004) {
          const phase = Math.atan2(im, re) / TAU;
          r += paletteChannel(phase, 0) * bright;
          g += paletteChannel(phase, 1) * bright;
          b += paletteChannel(phase, 2) * bright;
        }
        if (roomBytes[j]) { r = 0.075; g = 0.085; b = 0.14; }
        pixels[j] = tone(r + view.flash * 0.5);
        pixels[j + 1] = tone(g + view.flash * 0.6);
        pixels[j + 2] = tone(b + view.flash * 0.8);
        pixels[j + 3] = 255;
      }
    }
    fallback.bufferContext.putImageData(fallback.image, 0, 0);
    fallback.context.imageSmoothingEnabled = true;
    fallback.context.imageSmoothingQuality = 'high';
    fallback.context.drawImage(fallback.buffer, 0, 0, canvas.width, canvas.height);
  }

  /** Draw one frame. view = { time, locked, flash, norm, dt }. */
  function draw(world, view) {
    const rebake = world.version !== bakedVersion;
    if (rebake) bake(world);
    packField(world, view.norm, view.dt);
    const roomChanged = rebake || world.sweepers.length > 0;
    if (roomChanged) stampSweepers(world);
    if (gl) drawWebGL(roomChanged, view); else drawFallback(view);
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  }

  if (!initWebGL()) initFallback();
  return { draw, resize, get usingWebGL() { return !!gl; } };
}
