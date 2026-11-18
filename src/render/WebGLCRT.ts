import type { ViewportRect } from '../types';

const VERTEX_SHADER_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * Pass 1: Ping-Pong P39 / Burnt-Orange Phosphor Persistence Buffer
 * Accumulates strong, lingering cathode afterglow trails (~0.94–0.965 per 60Hz frame)
 * behind moving lander trusses, flames, radar sweeps, and dial needles.
 */
const ACCUM_FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;
uniform sampler2D uSourceTex;
uniform sampler2D uPrevTex;
uniform vec2 uResolution;
uniform float uDecayBase;
uniform float uDtFrames;

void main() {
  vec2 texel = 1.0 / max(uResolution, vec2(1.0));

  vec3 c0 = texture2D(uSourceTex, vUv).rgb;
  vec3 cL = texture2D(uSourceTex, vUv - vec2(texel.x * 1.1, 0.0)).rgb;
  vec3 cR = texture2D(uSourceTex, vUv + vec2(texel.x * 1.25, 0.0)).rgb;
  vec3 beam = c0 * 0.62 + cL * 0.20 + cR * 0.18;

  // Slight horizontal raster bleed on decaying phosphor persistence
  vec3 prev0 = texture2D(uPrevTex, clamp(vUv - vec2(texel.x * 0.4, 0.0), 0.001, 0.999)).rgb;
  vec3 prevSmear = (
    prev0 * 0.74 +
    texture2D(uPrevTex, clamp(vUv + vec2(texel.x * 1.1, 0.0), 0.001, 0.999)).rgb * 0.16 +
    texture2D(uPrevTex, clamp(vUv - vec2(0.0, texel.y * 0.9), 0.001, 0.999)).rgb * 0.10
  );

  // Long P39 green & burnt-orange phosphor persistence curve
  vec3 channelDecay = pow(
    vec3(uDecayBase - 0.010, uDecayBase + 0.008, uDecayBase - 0.035),
    vec3(uDtFrames)
  );
  vec3 decayed = prevSmear * channelDecay;

  // Flush tiny residual below background floor so unlit areas stay clean smoked gray-green
  decayed *= smoothstep(0.028, 0.085, max(decayed.r, max(decayed.g, decayed.b)));

  gl_FragColor = vec4(max(beam, decayed), 1.0);
}
`;

/**
 * Pass 2: 1979 Pixelated Raster CRT Tube Composite
 * Quantizes signal onto a vintage low-res CRT raster lattice, blends strong phosphor persistence,
 * applies tighter/smaller localized halation, lifts black floor for softer analog contrast,
 * tones down peak green brightness, and renders scanline/phosphor cell grid + smoked glass glare.
 */
const COMPOSITE_FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;
uniform sampler2D uSourceTex;
uniform sampler2D uAccumTex;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uTime;
uniform float uCrtIntensity;   // 0.0 .. 1.0 (bezel rotary dial)
uniform float uInterference;   // 0.0 .. 1.0 (EM ion storm)
uniform float uGlitch;         // 0.0 .. 1.0 (hard landing / hull breach tear)
uniform float uOverdrive;      // 0.0 .. 1.0 (high-G burn)

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 warpUV(vec2 uv, float amount) {
  vec2 centered = uv * 2.0 - 1.0;
  float r2 = dot(centered, centered);
  float k1 = 0.115 * amount;
  float k2 = 0.036 * amount;
  centered *= 1.0 + k1 * r2 + k2 * r2 * r2;
  centered *= 1.0 - 0.024 * amount;
  return centered * 0.5 + 0.5;
}

float roundedTubeMask(vec2 uv, float cornerRadius) {
  vec2 p = abs(uv * 2.0 - 1.0) - (1.0 - cornerRadius);
  float d = length(max(p, 0.0)) + min(max(p.x, p.y), 0.0) - cornerRadius;
  return 1.0 - smoothstep(-0.008, 0.010, d);
}

void main() {
  float dial = clamp(uCrtIntensity, 0.0, 1.0);
  float curveAmt = 0.28 + dial * 0.92;
  vec2 uv = warpUV(vUv, curveAmt);

  float mask = roundedTubeMask(uv, 0.068);
  if (mask <= 0.001 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    vec2 edgeDist = abs(vUv * 2.0 - 1.0);
    float rim = smoothstep(0.995, 0.92, max(edgeDist.x, edgeDist.y));
    float grain = (hash12(gl_FragCoord.xy * 0.5) - 0.5) * 0.015;
    vec3 bezelCol = mix(vec3(0.022, 0.029, 0.024), vec3(0.056, 0.070, 0.060), rim * 0.55) + grain;
    gl_FragColor = vec4(bezelCol, 1.0);
    return;
  }

  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  vec2 tubeCentered = uv * 2.0 - 1.0;
  float cornerR2 = dot(tubeCentered, tubeCentered);

  // Dynamic Signal Tear & Micro 60Hz Deflection Jitter
  float hvJitterX = sin(uTime * 376.99 + uv.y * 42.0) * 0.35 * dial * texel.x;
  float totalDisturb = clamp(uInterference * 0.62 + uGlitch * 1.25 + uOverdrive * 0.35, 0.0, 1.6);
  float tearWave = sin(uv.y * 29.0 + uTime * 21.0) * sin(uv.y * 8.5 - uTime * 13.0);
  float tearGate = step(0.74 - min(0.58, uGlitch * 0.52 + uOverdrive * 0.18 + uInterference * 0.24), abs(tearWave));
  float tearShift = tearGate * (hash12(vec2(floor(uv.y * 95.0), floor(uTime * 38.0))) - 0.5) * 0.038 * totalDisturb;

  vec2 rawSampleUv = clamp(uv + vec2(hvJitterX + tearShift, 0.0), 0.001, 0.999);

  // =========================================================================
  // 1979 RASTER CRT PIXELATION LATTICE
  // Quantizes smooth digital vectors onto discrete vintage CRT phosphor cells
  // (~1.55 CSS px pitch) while preserving crisp sub-cell phosphor edges!
  // =========================================================================
  float cellPitchPx = max(1.0, (1.15 + 0.55 * dial) * uDpr);
  vec2 gridDims = max(vec2(240.0), floor(uResolution / cellPitchPx));
  vec2 cellPos = rawSampleUv * gridDims;
  vec2 cellIndex = floor(cellPos);
  vec2 cellFrac = fract(cellPos);

  // Blend 78% quantized pixel center + 22% smooth sub-sample so small text stays legible yet pixelated
  vec2 quantUv = (cellIndex + 0.5) / gridDims;
  vec2 sampleUv = mix(rawSampleUv, quantUv, 0.78);

  // Subtle corner RGB convergence drift
  float fringePx = (0.55 * dial + cornerR2 * 1.1 * dial + totalDisturb * 3.0);
  vec2 convOffset = (tubeCentered * 0.6 + vec2(0.5, 0.1)) * fringePx * texel;

  vec3 liveC = texture2D(uSourceTex, sampleUv).rgb;
  liveC.r = mix(liveC.r, texture2D(uSourceTex, clamp(sampleUv + convOffset, 0.001, 0.999)).r, 0.5);
  liveC.b = mix(liveC.b, texture2D(uSourceTex, clamp(sampleUv - convOffset, 0.001, 0.999)).b, 0.5);

  // =========================================================================
  // STRONG P39 / BURNT-ORANGE PHOSPHOR PERSISTENCE TRAILS
  // =========================================================================
  vec3 accumC = texture2D(uAccumTex, quantUv).rgb * 0.70 +
                texture2D(uAccumTex, clamp(quantUv - vec2(1.8 / gridDims.x, 0.0), 0.001, 0.999)).rgb * 0.30;
  vec3 ghostTail = max(accumC - liveC, vec3(0.0));
  float tailWarmth = smoothstep(0.04, 0.30, ghostTail.r - ghostTail.g * 0.65);
  vec3 trailTint = mix(vec3(0.84, 1.02, 0.76), vec3(1.14, 0.65, 0.30), tailWarmth);
  vec3 beamWithPersistence = liveC + ghostTail * trailTint * (0.72 + 0.30 * dial);

  // =========================================================================
  // TIGHTER, REDUCED-SCALE ANALOG HALATION / BLOOM
  // =========================================================================
  vec3 localHalo = vec3(0.0);
  float rTight = (1.35 + dial * 1.25) * uDpr;
  float rMid = (3.2 + dial * 2.4) * uDpr;

  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2( rTight, 0.0) * texel, 0.001, 0.999)).rgb * 0.16;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2(-rTight, 0.0) * texel, 0.001, 0.999)).rgb * 0.16;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2(0.0,  rTight) * texel, 0.001, 0.999)).rgb * 0.16;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2(0.0, -rTight) * texel, 0.001, 0.999)).rgb * 0.16;

  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2( rMid,  rMid) * 0.71 * texel, 0.001, 0.999)).rgb * 0.09;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2(-rMid,  rMid) * 0.71 * texel, 0.001, 0.999)).rgb * 0.09;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2( rMid, -rMid) * 0.71 * texel, 0.001, 0.999)).rgb * 0.09;
  localHalo += texture2D(uAccumTex, clamp(sampleUv + vec2(-rMid, -rMid) * 0.71 * texel, 0.001, 0.999)).rgb * 0.09;

  vec3 bloomCol = max(localHalo - vec3(0.045), vec3(0.0)) * (0.22 + 0.30 * dial);
  float bloomWarmth = smoothstep(0.03, 0.25, bloomCol.r - bloomCol.g * 0.65);
  vec3 bloomTint = mix(vec3(0.82, 0.98, 0.82), vec3(1.16, 0.66, 0.32), bloomWarmth);

  // =========================================================================
  // REDUCED CONTRAST: SMOKED GRAY-GREEN CATHODE FLOOR + TONED-DOWN GREEN PEAK
  // =========================================================================
  vec3 smokedFloor = vec3(0.038, 0.076, 0.048) * (1.0 - cornerR2 * 0.36);
  vec3 col = smokedFloor + beamWithPersistence * 0.90 + bloomCol * bloomTint;

  // Gently roll off peak green brightness so green is warm & analog rather than blinding neon
  float isGreenDom = smoothstep(0.02, 0.25, col.g - col.r);
  col.g *= mix(1.0, 0.86, isGreenDom);
  // Soft analog shoulder compression
  col = col / (1.0 + col * 0.20);

  // Discrete Pixel-Cell & Curved Scanline Grid (makes individual CRT pixels tactile!)
  float cellGapX = smoothstep(0.0, 0.20, cellFrac.x) * smoothstep(1.0, 0.80, cellFrac.x);
  float cellGapY = smoothstep(0.0, 0.26, cellFrac.y) * smoothstep(1.0, 0.74, cellFrac.y);
  float pixelMatrix = mix(1.0, cellGapX * cellGapY, 0.24 + 0.22 * dial);

  float corePeak = max(liveC.r, max(liveC.g, liveC.b));
  // Bright pixels fill slightly more of their phosphor cell; dim background shows clear raster grid
  col *= mix(pixelMatrix, 1.0, corePeak * 0.35);

  // Subtle 60Hz Cathode Flicker & Analog Grain
  float flicker = 1.0 - (0.008 + 0.014 * dial) * sin(uTime * 376.991);
  col *= flicker;

  float snowAmt = uInterference * 0.13 + uGlitch * 0.26 + uOverdrive * 0.03 + 0.020;
  float snow = hash12(cellIndex + vec2(floor(uTime * 30.0) * 17.3, floor(uTime * 30.0) * 9.1)) - 0.5;
  col += vec3(0.28, 0.72, 0.38) * snow * snowAmt;

  // Smoked Glass Studio Glare & Subtle Scuffs
  vec2 glarePos1 = tubeCentered - vec2(-0.34, 0.42);
  float warmLampGlare = exp(-dot(glarePos1, glarePos1) * 5.6) * (0.034 + 0.042 * dial);
  vec2 glarePos2 = tubeCentered - vec2(-0.55, 0.64);
  float glassSheen = exp(-dot(glarePos2 * vec2(0.7, 1.3), glarePos2 * vec2(0.7, 1.3)) * 2.4) * (0.022 + 0.028 * dial);
  col += vec3(0.92, 0.76, 0.56) * warmLampGlare + vec3(0.42, 0.64, 0.50) * glassSheen;

  // Recessed Bezel Shadow Vignette
  float vignette = clamp(1.0 - cornerR2 * (0.14 + 0.18 * dial), 0.42, 1.0);
  float edgeShadow = smoothstep(0.0, 0.065, 1.0 - max(abs(tubeCentered.x), abs(tubeCentered.y)));
  col *= vignette * mix(0.28, 1.0, edgeShadow);

  gl_FragColor = vec4(col * mask, 1.0);
}
`;

interface FboTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

export class WebGLCRT {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private fallback2d: CanvasRenderingContext2D | null = null;

  private accumProgram: WebGLProgram | null = null;
  private compositeProgram: WebGLProgram | null = null;
  private sourceTexture: WebGLTexture | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  private pingPong: [FboTarget, FboTarget] | null = null;
  private readIdx = 0;
  private fboWidth = 0;
  private fboHeight = 0;
  private texWidth = 0;
  private texHeight = 0;
  private lastRenderTime = -1;

  // Pass 1 Uniforms
  private aAccumPos = -1;
  private uAccumSource: WebGLUniformLocation | null = null;
  private uAccumPrev: WebGLUniformLocation | null = null;
  private uAccumRes: WebGLUniformLocation | null = null;
  private uAccumDecay: WebGLUniformLocation | null = null;
  private uAccumDtFrames: WebGLUniformLocation | null = null;

  // Pass 2 Uniforms
  private aCompPos = -1;
  private uCompSource: WebGLUniformLocation | null = null;
  private uCompAccum: WebGLUniformLocation | null = null;
  private uCompRes: WebGLUniformLocation | null = null;
  private uCompDpr: WebGLUniformLocation | null = null;
  private uCompTime: WebGLUniformLocation | null = null;
  private uCompCrtIntensity: WebGLUniformLocation | null = null;
  private uCompInterference: WebGLUniformLocation | null = null;
  private uCompGlitch: WebGLUniformLocation | null = null;
  private uCompOverdrive: WebGLUniformLocation | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initWebGL();
  }

  private initWebGL(): void {
    const gl =
      (this.canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      }) as WebGLRenderingContext | null) ||
      (this.canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    if (!gl) {
      this.fallback2d = this.canvas.getContext('2d');
      return;
    }

    const accumProg = this.buildProgram(gl, VERTEX_SHADER_SRC, ACCUM_FRAGMENT_SRC);
    const compProg = this.buildProgram(gl, VERTEX_SHADER_SRC, COMPOSITE_FRAGMENT_SRC);
    if (!accumProg || !compProg) {
      this.fallback2d = this.canvas.getContext('2d');
      return;
    }

    this.gl = gl;
    this.accumProgram = accumProg;
    this.compositeProgram = compProg;

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    const verts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this.sourceTexture = this.createLinearTexture(gl);

    this.aAccumPos = gl.getAttribLocation(accumProg, 'aPosition');
    this.uAccumSource = gl.getUniformLocation(accumProg, 'uSourceTex');
    this.uAccumPrev = gl.getUniformLocation(accumProg, 'uPrevTex');
    this.uAccumRes = gl.getUniformLocation(accumProg, 'uResolution');
    this.uAccumDecay = gl.getUniformLocation(accumProg, 'uDecayBase');
    this.uAccumDtFrames = gl.getUniformLocation(accumProg, 'uDtFrames');

    this.aCompPos = gl.getAttribLocation(compProg, 'aPosition');
    this.uCompSource = gl.getUniformLocation(compProg, 'uSourceTex');
    this.uCompAccum = gl.getUniformLocation(compProg, 'uAccumTex');
    this.uCompRes = gl.getUniformLocation(compProg, 'uResolution');
    this.uCompDpr = gl.getUniformLocation(compProg, 'uDpr');
    this.uCompTime = gl.getUniformLocation(compProg, 'uTime');
    this.uCompCrtIntensity = gl.getUniformLocation(compProg, 'uCrtIntensity');
    this.uCompInterference = gl.getUniformLocation(compProg, 'uInterference');
    this.uCompGlitch = gl.getUniformLocation(compProg, 'uGlitch');
    this.uCompOverdrive = gl.getUniformLocation(compProg, 'uOverdrive');
  }

  private createLinearTexture(gl: WebGLRenderingContext): WebGLTexture | null {
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private ensurePingPongFbos(gl: WebGLRenderingContext, width: number, height: number): void {
    if (this.pingPong && this.fboWidth === width && this.fboHeight === height) {
      return;
    }

    if (this.pingPong) {
      for (const target of this.pingPong) {
        gl.deleteFramebuffer(target.fbo);
        gl.deleteTexture(target.tex);
      }
      this.pingPong = null;
    }

    const buildTarget = (): FboTarget | null => {
      const tex = this.createLinearTexture(gl);
      const fbo = gl.createFramebuffer();
      if (!tex || !fbo) return null;

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
        return null;
      }

      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { fbo, tex };
    };

    const t0 = buildTarget();
    const t1 = buildTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (t0 && t1) {
      this.pingPong = [t0, t1];
      this.fboWidth = width;
      this.fboHeight = height;
      this.readIdx = 0;
    }
  }

  private buildProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
    const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('WebGL link warning:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  }

  private compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('WebGL Shader compile warning:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  public mapClientToCrtUv(
    clientX: number,
    clientY: number,
    crtRect: ViewportRect,
    crtIntensity: number
  ): { u: number; v: number; inside: boolean } {
    const rawU = (clientX - crtRect.x) / Math.max(1, crtRect.width);
    const rawV = (clientY - crtRect.y) / Math.max(1, crtRect.height);
    if (rawU < 0 || rawU > 1 || rawV < 0 || rawV > 1) {
      return { u: Math.max(0, Math.min(1, rawU)), v: Math.max(0, Math.min(1, rawV)), inside: false };
    }

    const dial = Math.max(0, Math.min(1, crtIntensity));
    const amount = 0.28 + dial * 0.92;
    let cx = rawU * 2.0 - 1.0;
    let cy = rawV * 2.0 - 1.0;
    const r2 = cx * cx + cy * cy;
    const k1 = 0.115 * amount;
    const k2 = 0.036 * amount;
    const scale = (1.0 + k1 * r2 + k2 * r2 * r2) * (1.0 - 0.024 * amount);
    cx *= scale;
    cy *= scale;

    const u = cx * 0.5 + 0.5;
    const v = cy * 0.5 + 0.5;
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    return {
      u: Math.max(0, Math.min(1, u)),
      v: Math.max(0, Math.min(1, v)),
      inside,
    };
  }

  public render(
    sourceCanvas: HTMLCanvasElement,
    crtRectCss: ViewportRect,
    dpr: number,
    timeSec: number,
    crtIntensity: number,
    interference: number,
    glitch: number,
    overdrive: number
  ): void {
    const gl = this.gl;
    if (!gl || !this.accumProgram || !this.compositeProgram || !this.sourceTexture) {
      if (this.fallback2d) {
        this.fallback2d.fillStyle = '#0A0D0B';
        this.fallback2d.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.fallback2d.drawImage(
          sourceCanvas,
          crtRectCss.x * dpr,
          crtRectCss.y * dpr,
          crtRectCss.width * dpr,
          crtRectCss.height * dpr
        );
      }
      return;
    }

    const dtSec =
      this.lastRenderTime < 0
        ? 1 / 60
        : Math.max(0.004, Math.min(0.1, timeSec - this.lastRenderTime));
    this.lastRenderTime = timeSec;
    const dtFrames = dtSec * 60.0;

    const srcW = Math.max(1, sourceCanvas.width);
    const srcH = Math.max(1, sourceCanvas.height);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    if (this.texWidth !== srcW || this.texHeight !== srcH) {
      this.texWidth = srcW;
      this.texHeight = srcH;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    }

    this.ensurePingPongFbos(gl, srcW, srcH);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);

    // Pass 1: Strong Phosphor Persistence Ping-Pong FBO (~0.935–0.968 per 60Hz frame)
    let accumTexToSample: WebGLTexture = this.sourceTexture;
    if (this.pingPong) {
      const readTarget = this.pingPong[this.readIdx];
      const writeIdx = 1 - this.readIdx;
      const writeTarget = this.pingPong[writeIdx];

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.fbo);
      gl.viewport(0, 0, srcW, srcH);
      gl.useProgram(this.accumProgram);

      gl.enableVertexAttribArray(this.aAccumPos);
      gl.vertexAttribPointer(this.aAccumPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.uniform1i(this.uAccumSource, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, readTarget.tex);
      gl.uniform1i(this.uAccumPrev, 1);

      const decayBase = 0.932 + Math.max(0, Math.min(1, crtIntensity)) * 0.033;
      gl.uniform2f(this.uAccumRes, srcW, srcH);
      gl.uniform1f(this.uAccumDecay, decayBase);
      gl.uniform1f(this.uAccumDtFrames, dtFrames);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      this.readIdx = writeIdx;
      accumTexToSample = writeTarget.tex;
    }

    // Pass 2: Pixelated Raster CRT Tube Composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.039, 0.051, 0.043, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const vpX = Math.round(crtRectCss.x * dpr);
    const vpW = Math.round(crtRectCss.width * dpr);
    const vpH = Math.round(crtRectCss.height * dpr);
    const vpY = Math.round(this.canvas.height - (crtRectCss.y + crtRectCss.height) * dpr);

    gl.viewport(vpX, vpY, vpW, vpH);
    gl.useProgram(this.compositeProgram);

    gl.enableVertexAttribArray(this.aCompPos);
    gl.vertexAttribPointer(this.aCompPos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(this.uCompSource, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, accumTexToSample);
    gl.uniform1i(this.uCompAccum, 1);

    gl.uniform2f(this.uCompRes, vpW, vpH);
    gl.uniform1f(this.uCompDpr, dpr);
    gl.uniform1f(this.uCompTime, timeSec);
    gl.uniform1f(this.uCompCrtIntensity, crtIntensity);
    gl.uniform1f(this.uCompInterference, interference);
    gl.uniform1f(this.uCompGlitch, glitch);
    gl.uniform1f(this.uCompOverdrive, overdrive);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
