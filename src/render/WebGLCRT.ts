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
 * Pass 1: Electron-Beam Spot Softening + Ping-Pong Phosphor Persistence Buffer
 * Softens razor-sharp 2D canvas strokes into an analog electron beam and accumulates
 * P39 green / amber decaying trails (~0.88-0.93 per 60Hz frame) with subtle horizontal bleed.
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

  // Soften raw digital vector edges into a warm analog electron-beam spot
  // with slight horizontal video-amplifier smear
  vec3 c0 = texture2D(uSourceTex, vUv).rgb;
  vec3 cL = texture2D(uSourceTex, vUv - vec2(texel.x * 1.15, 0.0)).rgb;
  vec3 cR = texture2D(uSourceTex, vUv + vec2(texel.x * 1.35, 0.0)).rgb;
  vec3 cU = texture2D(uSourceTex, vUv + vec2(0.0, texel.y * 0.95)).rgb;
  vec3 cD = texture2D(uSourceTex, vUv - vec2(0.0, texel.y * 0.95)).rgb;

  vec3 softenedBeam = c0 * 0.48 + (cL * 0.16 + cR * 0.14 + cU * 0.11 + cD * 0.11);

  // Sample previous persistence frame with micro rightward raster phosphor bleed
  vec3 prev0 = texture2D(uPrevTex, clamp(vUv - vec2(texel.x * 0.45, 0.0), 0.001, 0.999)).rgb;
  vec3 prevBlur = (
    prev0 * 0.68 +
    texture2D(uPrevTex, clamp(vUv + vec2(texel.x * 1.2, 0.0), 0.001, 0.999)).rgb * 0.18 +
    texture2D(uPrevTex, clamp(vUv - vec2(0.0, texel.y * 1.0), 0.001, 0.999)).rgb * 0.14
  );

  // Authentic P39 green + amber long-persistence decay rates per channel
  vec3 channelDecay = pow(
    vec3(uDecayBase - 0.018, uDecayBase + 0.012, uDecayBase - 0.045),
    vec3(uDtFrames)
  );
  vec3 decayed = prevBlur * channelDecay;

  // Flush sub-threshold residual values to zero so deep black-green never fogs
  decayed *= smoothstep(0.008, 0.035, max(decayed.r, max(decayed.g, decayed.b)));

  vec3 outCol = max(softenedBeam, decayed);
  gl_FragColor = vec4(outCol, 1.0);
}
`;

/**
 * Pass 2: Curved P39/Amber Cathode-Ray Tube Composite
 * Applies curved glass barrel distortion, corner electron-beam defocus, phosphor ghost trails,
 * multi-ring glass halation, dense curved scanlines, shadow-mask triads, 60Hz HV deflection jitter,
 * dynamic horizontal sync tears, inner bezel vignette, and smoked glass glare/scuffs.
 */
const COMPOSITE_FRAGMENT_SRC = `
precision highp float;

varying vec2 vUv;
uniform sampler2D uSourceTex;
uniform sampler2D uAccumTex;
uniform vec2 uResolution;
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

  // Moulded dark CRT bezel cut-out & recessed tube rim
  float mask = roundedTubeMask(uv, 0.068);
  if (mask <= 0.001 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    vec2 edgeDist = abs(vUv * 2.0 - 1.0);
    float rim = smoothstep(0.995, 0.92, max(edgeDist.x, edgeDist.y));
    float grain = (hash12(gl_FragCoord.xy * 0.5) - 0.5) * 0.015;
    vec3 bezelCol = mix(vec3(0.020, 0.027, 0.022), vec3(0.052, 0.066, 0.056), rim * 0.55) + grain;
    gl_FragColor = vec4(bezelCol, 1.0);
    return;
  }

  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  vec2 tubeCentered = uv * 2.0 - 1.0;
  float cornerR2 = dot(tubeCentered, tubeCentered);

  // Micro 60Hz high-voltage deflection jitter + high-G burn / impact sync tear
  float hvJitterX = sin(uTime * 376.99 + uv.y * 42.0) * 0.38 * dial * texel.x;
  float hvJitterY = cos(uTime * 188.50) * 0.22 * dial * texel.y;

  float totalDisturb = clamp(uInterference * 0.62 + uGlitch * 1.25 + uOverdrive * 0.35, 0.0, 1.6);
  float tearWave = sin(uv.y * 29.0 + uTime * 21.0) * sin(uv.y * 8.5 - uTime * 13.0);
  float tearGate = step(0.74 - min(0.58, uGlitch * 0.52 + uOverdrive * 0.18 + uInterference * 0.24), abs(tearWave));
  float tearShift = tearGate * (hash12(vec2(floor(uv.y * 95.0), floor(uTime * 38.0))) - 0.5) * 0.038 * totalDisturb;

  vec2 sampleUv = clamp(uv + vec2(hvJitterX + tearShift, hvJitterY), 0.001, 0.999);

  // Corner Defocus + Chromatic Convergence Drift toward tube perimeter
  float defocus = (0.55 + cornerR2 * 1.55) * (0.45 + dial * 0.75);
  float fringePx = (0.75 * dial + cornerR2 * 1.35 * dial + totalDisturb * 3.6);
  vec2 convOffset = (tubeCentered * 0.65 + vec2(0.6, 0.15)) * fringePx * texel;

  // Softened Electron-Beam Live Frame Sample (with corner defocus)
  vec3 liveC = texture2D(uSourceTex, sampleUv).rgb * 0.42;
  liveC += texture2D(uSourceTex, clamp(sampleUv + vec2(defocus, 0.0) * texel, 0.001, 0.999)).rgb * 0.145;
  liveC += texture2D(uSourceTex, clamp(sampleUv - vec2(defocus, 0.0) * texel, 0.001, 0.999)).rgb * 0.145;
  liveC += texture2D(uSourceTex, clamp(sampleUv + vec2(0.0, defocus) * texel, 0.001, 0.999)).rgb * 0.145;
  liveC += texture2D(uSourceTex, clamp(sampleUv - vec2(0.0, defocus) * texel, 0.001, 0.999)).rgb * 0.145;

  // Apply subtle RGB gun convergence fringe
  float rConv = texture2D(uSourceTex, clamp(sampleUv + convOffset, 0.001, 0.999)).r;
  float bConv = texture2D(uSourceTex, clamp(sampleUv - convOffset, 0.001, 0.999)).b;
  liveC.r = mix(liveC.r, rConv, 0.55);
  liveC.b = mix(liveC.b, bConv, 0.55);

  // Phosphor Persistence Ghost Trail from Ping-Pong FBO (with slight horizontal color bleed)
  vec3 accumC = texture2D(uAccumTex, sampleUv).rgb * 0.65 +
                texture2D(uAccumTex, clamp(sampleUv - vec2(2.4 * texel.x, 0.0), 0.001, 0.999)).rgb * 0.35;
  vec3 ghostTail = max(accumC - liveC, vec3(0.0));
  float tailWarmth = smoothstep(0.04, 0.32, ghostTail.r - ghostTail.g * 0.65);
  vec3 trailTint = mix(vec3(0.90, 1.08, 0.78), vec3(1.16, 0.68, 0.32), tailWarmth);
  vec3 beamWithPersistence = liveC + ghostTail * trailTint * (0.48 + 0.34 * dial);

  // Incandescent Electron-Beam Hot Core + Multi-Ring Glass Halation / Bloom
  float corePeak = max(liveC.r, max(liveC.g, liveC.b));
  float liveWarmth = smoothstep(0.04, 0.32, liveC.r - liveC.g * 0.65);
  vec3 hotCore = pow(max(liveC - vec3(0.32), vec3(0.0)), vec3(1.35)) *
                 mix(vec3(0.65, 0.75, 0.65), vec3(0.85, 0.44, 0.18), liveWarmth);

  vec3 innerHalation = vec3(0.0);
  vec3 wideHalation = vec3(0.0);
  float rInner = 2.4 + dial * 2.4;
  float rWide = 7.0 + dial * 6.5;

  innerHalation += texture2D(uAccumTex, clamp(sampleUv + vec2( rInner, 0.0) * texel, 0.001, 0.999)).rgb * 0.16;
  innerHalation += texture2D(uAccumTex, clamp(sampleUv + vec2(-rInner, 0.0) * texel, 0.001, 0.999)).rgb * 0.16;
  innerHalation += texture2D(uAccumTex, clamp(sampleUv + vec2(0.0,  rInner) * texel, 0.001, 0.999)).rgb * 0.16;
  innerHalation += texture2D(uAccumTex, clamp(sampleUv + vec2(0.0, -rInner) * texel, 0.001, 0.999)).rgb * 0.16;
  innerHalation += texture2D(uAccumTex, clamp(sampleUv + vec2( rInner,  rInner) * 0.71 * texel, 0.001, 0.999)).rgb * 0.09;
  innerHalation += texture2D(uAccumTex, clamp(sampleUv + vec2(-rInner,  rInner) * 0.71 * texel, 0.001, 0.999)).rgb * 0.09;
  innerHalation += texture2D(uAccumTex, clamp(sampleUv + vec2( rInner, -rInner) * 0.71 * texel, 0.001, 0.999)).rgb * 0.09;
  innerHalation += texture2D(uAccumTex, clamp(sampleUv + vec2(-rInner, -rInner) * 0.71 * texel, 0.001, 0.999)).rgb * 0.09;

  wideHalation += texture2D(uAccumTex, clamp(sampleUv + vec2( rWide, 0.0) * texel, 0.001, 0.999)).rgb * 0.15;
  wideHalation += texture2D(uAccumTex, clamp(sampleUv + vec2(-rWide, 0.0) * texel, 0.001, 0.999)).rgb * 0.15;
  wideHalation += texture2D(uAccumTex, clamp(sampleUv + vec2(0.0,  rWide) * texel, 0.001, 0.999)).rgb * 0.15;
  wideHalation += texture2D(uAccumTex, clamp(sampleUv + vec2(0.0, -rWide) * texel, 0.001, 0.999)).rgb * 0.15;
  wideHalation += texture2D(uAccumTex, clamp(sampleUv + vec2( rWide,  rWide) * 0.71 * texel, 0.001, 0.999)).rgb * 0.10;
  wideHalation += texture2D(uAccumTex, clamp(sampleUv + vec2(-rWide,  rWide) * 0.71 * texel, 0.001, 0.999)).rgb * 0.10;
  wideHalation += texture2D(uAccumTex, clamp(sampleUv + vec2( rWide, -rWide) * 0.71 * texel, 0.001, 0.999)).rgb * 0.10;
  wideHalation += texture2D(uAccumTex, clamp(sampleUv + vec2(-rWide, -rWide) * 0.71 * texel, 0.001, 0.999)).rgb * 0.10;

  vec3 bloomCol = max(innerHalation - vec3(0.02), vec3(0.0)) * (0.48 + 0.58 * dial) +
                  max(wideHalation - vec3(0.025), vec3(0.0)) * (0.32 + 0.48 * dial);
  float bloomWarmth = smoothstep(0.03, 0.25, bloomCol.r - bloomCol.g * 0.65);
  vec3 bloomTint = mix(vec3(0.86, 1.08, 0.86), vec3(1.18, 0.68, 0.36), bloomWarmth);

  // Subtle ambient green-smoked CRT phosphor faceplate tint (like the 1979 reference photo)
  vec3 faceplateBase = vec3(0.012, 0.038, 0.020) * (1.0 - cornerR2 * 0.42);
  vec3 col = faceplateBase + beamWithPersistence + hotCore + bloomCol * bloomTint;

  // Dense Curved CRT Scanlines + Shadow-Mask Aperture Texture
  float curvedLineCoord = uv.y * uResolution.y * 0.52;
  float scanWave = sin(curvedLineCoord * 6.2831853) * 0.5 + 0.5;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  // Bright electron beams bloom across scanline gaps; dim areas show crisp scanlines
  float scanStrength = (0.11 + 0.20 * dial) * (1.0 - clamp(corePeak * 0.68, 0.0, 0.68));
  col *= 1.0 - scanStrength * scanWave;

  // Staggered CRT Shadow-Mask Triad Texture
  float maskRow = mod(floor(gl_FragCoord.y), 2.0) * 1.5708;
  float shadowMask = sin(gl_FragCoord.x * 2.35 + maskRow) * 0.5 + 0.5;
  col *= 1.0 - (0.04 + 0.065 * dial) * shadowMask;

  // 60Hz High-Voltage Cathode Hum & Flicker
  float flicker = 1.0 - (0.010 + 0.018 * dial) * sin(uTime * 376.991)
                      - 0.008 * dial * sin(uTime * 62.83 + uv.y * 5.0);
  col *= flicker;

  // Analog Static Snow (storm interference, high-G overdrive, impact shock)
  float snowAmt = uInterference * 0.13 + uGlitch * 0.28 + uOverdrive * 0.035 + 0.012 * dial;
  float snow = hash12(gl_FragCoord.xy + vec2(uTime * 613.7, uTime * 271.3)) - 0.5;
  col += vec3(0.26, 0.95, 0.44) * snow * snowAmt;

  // Smoked Glass Overhead Studio Glare & Subtle Micro-Scuffs (matching reference monitor)
  // Note: uv.y = 1.0 is top of CRT in WebGL UV space
  vec2 glarePos1 = tubeCentered - vec2(-0.34, 0.42);
  float warmLampGlare = exp(-dot(glarePos1, glarePos1) * 5.6) * (0.038 + 0.048 * dial);
  vec2 glarePos2 = tubeCentered - vec2(-0.55, 0.64);
  float glassSheen = exp(-dot(glarePos2 * vec2(0.7, 1.3), glarePos2 * vec2(0.7, 1.3)) * 2.4) * (0.025 + 0.032 * dial);

  // Subtle curved glass micro-scuff catchlights illuminated near glare region
  float scuffLine1 = exp(-abs((tubeCentered.x * 0.82 + tubeCentered.y * 0.57) - 0.08) * 190.0) *
                     smoothstep(0.55, 0.0, length(glarePos1));
  float scuffLine2 = exp(-abs((tubeCentered.x * -0.45 + tubeCentered.y * 0.89) - 0.46) * 230.0) *
                     smoothstep(0.65, 0.1, length(glarePos2));
  float scuffs = (scuffLine1 + scuffLine2) * 0.022 * dial;

  col += vec3(0.95, 0.84, 0.64) * warmLampGlare +
         vec3(0.45, 0.72, 0.56) * (glassSheen + scuffs);

  // Deep Recessed Bezel Shadow Vignette around curved glass perimeter
  float vignette = clamp(1.0 - cornerR2 * (0.15 + 0.20 * dial), 0.38, 1.0);
  float edgeShadow = smoothstep(0.0, 0.065, 1.0 - max(abs(tubeCentered.x), abs(tubeCentered.y)));
  col *= vignette * mix(0.25, 1.0, edgeShadow);

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

    // Align uploaded 2D Canvas Y-orientation with WebGL FBO texture space
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    const verts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this.sourceTexture = this.createLinearTexture(gl);

    // Cache Pass 1 locations
    this.aAccumPos = gl.getAttribLocation(accumProg, 'aPosition');
    this.uAccumSource = gl.getUniformLocation(accumProg, 'uSourceTex');
    this.uAccumPrev = gl.getUniformLocation(accumProg, 'uPrevTex');
    this.uAccumRes = gl.getUniformLocation(accumProg, 'uResolution');
    this.uAccumDecay = gl.getUniformLocation(accumProg, 'uDecayBase');
    this.uAccumDtFrames = gl.getUniformLocation(accumProg, 'uDtFrames');

    // Cache Pass 2 locations
    this.aCompPos = gl.getAttribLocation(compProg, 'aPosition');
    this.uCompSource = gl.getUniformLocation(compProg, 'uSourceTex');
    this.uCompAccum = gl.getUniformLocation(compProg, 'uAccumTex');
    this.uCompRes = gl.getUniformLocation(compProg, 'uResolution');
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

  /**
   * Maps CSS viewport coordinates (clientX, clientY) inside crtRect through the exact
   * CRT barrel distortion curve so mouse aiming & HUD buttons align sub-pixel accurately.
   */
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

    const dtSec = this.lastRenderTime < 0 ? 1 / 60 : Math.max(0.004, Math.min(0.1, timeSec - this.lastRenderTime));
    this.lastRenderTime = timeSec;
    const dtFrames = dtSec * 60.0;

    const srcW = Math.max(1, sourceCanvas.width);
    const srcH = Math.max(1, sourceCanvas.height);

    // Upload newly rendered 2D Vector Canvas frame
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

    // =========================================================================
    // PASS 1: PING-PONG PHOSPHOR PERSISTENCE & ELECTRON BEAM SOFTENING
    // =========================================================================
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

      // Decay ~0.88–0.93 per 60Hz frame
      const decayBase = 0.885 + Math.max(0, Math.min(1, crtIntensity)) * 0.042;
      gl.uniform2f(this.uAccumRes, srcW, srcH);
      gl.uniform1f(this.uAccumDecay, decayBase);
      gl.uniform1f(this.uAccumDtFrames, dtFrames);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      this.readIdx = writeIdx;
      accumTexToSample = writeTarget.tex;
    }

    // =========================================================================
    // PASS 2: CURVED CRT TUBE COMPOSITE TO SCREEN VIEWPORT
    // =========================================================================
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
    gl.uniform1f(this.uCompTime, timeSec);
    gl.uniform1f(this.uCompCrtIntensity, crtIntensity);
    gl.uniform1f(this.uCompInterference, interference);
    gl.uniform1f(this.uCompGlitch, glitch);
    gl.uniform1f(this.uCompOverdrive, overdrive);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
