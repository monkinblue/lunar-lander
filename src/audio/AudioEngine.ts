import type { SfxId, VoiceCalloutId } from '../types';

interface ManifestFileEntry {
  path: string;
  category: 'loop' | 'sfx' | 'voice';
  bytes: number;
}

interface AudioManifestData {
  version: number;
  generatedAt: string | null;
  voiceId: string | null;
  assets: Record<string, ManifestFileEntry>;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;

  private intercomInput: GainNode | null = null;
  // Dedicated warm dampened ASMR keyboard bus (rolls off harsh highs, boosts 210Hz thock body)
  private asmrKeyBus: GainNode | null = null;

  // Continuous DSP loop nodes (Dual-Layer Muted Flame Rumble + RCS + Space Ambience + Wind)
  private mainThrusterSource: AudioBufferSourceNode | null = null;
  private synthFlameRumbleSource: AudioBufferSourceNode | null = null;
  private mainThrusterFilter: BiquadFilterNode | null = null;
  private mainThrusterPostLp: BiquadFilterNode | null = null;
  private mainThrusterGain: GainNode | null = null;

  // Smoothed per-frame DSP state (prevents Web Audio setTargetAtTime automation queue lockup)
  private curMainFlameGain = 0;
  private curMainFlameCutoff = 340;
  private curMainFlameRate = 0.86;
  private curRcsGain = 0;
  private curRcsPan = 0;
  private curWindGain = 0;
  private curWindFreq = 450;
  private curEerieGain = 0.11;
  private curSpaceGain = 0.15;

  private rcsThrusterSource: AudioBufferSourceNode | null = null;
  private rcsPanner: StereoPannerNode | null = null;
  private rcsFilter: BiquadFilterNode | null = null;
  private rcsGain: GainNode | null = null;

  private eerieAmbienceSource: AudioBufferSourceNode | null = null;
  private eerieAmbienceFilter: BiquadFilterNode | null = null;
  private eerieAmbienceGain: GainNode | null = null;
  private deepSpaceBusGain: GainNode | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private buffers = new Map<string, AudioBuffer>();
  private decodedRealAssets = new Set<string>();
  private bufferOnsets = new Map<string, number>();
  private rawPrefetched = new Map<string, { data: ArrayBuffer; category: 'loop' | 'sfx' | 'voice' }>();
  private bootStartPromise: Promise<void> | null = null;
  private prefetchPromise: Promise<void> | null = null;
  private decodePromise: Promise<void> | null = null;
  private bootStartupSource: AudioBufferSourceNode | null = null;
  private bootStartupGain: GainNode | null = null;

  private muted = false;
  private unlocked = false;
  private activeVoiceSource: AudioBufferSourceNode | null = null;
  private lastVoiceTime = 0;
  private lastKlaxonTime = 0;
  private lastKeyclickTime = 0;
  private keyAltToggle = false;

  constructor() {
    this.bootStartPromise = this.prefetchBootStartAudio();
    this.prefetchPromise = this.prefetchManifestAndMp3s();
  }

  private async prefetchBootStartAudio(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL || './';
      const prefix = base === '/' ? '.' : base.replace(/\/$/, '');
      const res = await fetch(`${prefix}/audio/homeade_computer_start.m4a`);
      if (!res.ok) return;
      const arr = await res.arrayBuffer();
      if (arr.byteLength > 512) {
        this.rawPrefetched.set('homeade_computer_start', { data: arr, category: 'sfx' });
      }
    } catch {
      // Fallback handled gracefully if offline
    }
  }

  private async ensureBootStartDecoded(): Promise<void> {
    if (!this.ctx || this.decodedRealAssets.has('homeade_computer_start')) return;
    if (this.bootStartPromise) {
      await this.bootStartPromise;
    }
    const item = this.rawPrefetched.get('homeade_computer_start');
    if (!item || !this.ctx || this.decodedRealAssets.has('homeade_computer_start')) return;
    try {
      const copy = item.data.slice(0);
      const decoded = await this.ctx.decodeAudioData(copy);
      this.decodedRealAssets.add('homeade_computer_start');
      this.buffers.set('homeade_computer_start', decoded);
      this.bufferOnsets.set('homeade_computer_start', 0);
    } catch {
      // Fallback if browser codec fails
    }
  }

  private async prefetchManifestAndMp3s(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL || './';
      const prefix = base === '/' ? '.' : base.replace(/\/$/, '');
      const manifestUrl = `${prefix}/audio/manifest.json`;
      const res = await fetch(manifestUrl, { cache: 'no-cache' });
      if (!res.ok) return;
      const data = (await res.json()) as Partial<AudioManifestData>;
      if (!data || typeof data.assets !== 'object' || data.assets === null) return;

      const entries = Object.entries(data.assets).filter(
        ([id]) => id !== 'ambient_crt_buzz' && id !== 'homeade_computer_start'
      );
      await Promise.all(
        entries.map(async ([id, meta]) => {
          try {
            const assetUrl = `${prefix}${meta.path}`;
            const mp3Res = await fetch(assetUrl);
            if (!mp3Res.ok) return;
            const arr = await mp3Res.arrayBuffer();
            if (arr.byteLength > 512) {
              this.rawPrefetched.set(id, { data: arr, category: meta.category });
            }
          } catch {
            // Individual asset fallback to synth if unreachable
          }
        })
      );

      if (this.ctx) {
        await this.decodePrefetchedBuffers();
      }
    } catch {
      // Silent fallback to procedural synthesis if offline
    }
  }

  /**
   * Finds exact transient onset timestamp inside an AudioBuffer so rapid ASMR
   * scrolling text clacks have zero leading silence lag.
   */
  private detectTransientOnsetSec(buf: AudioBuffer): number {
    const ch = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    const thresh = Math.max(0.02, peak * 0.16);
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) >= thresh) {
        return Math.max(0, i / buf.sampleRate - 0.003);
      }
    }
    return 0;
  }

  /**
   * Trims MP3 encoder boundary padding and builds a mathematically continuous
   * overlap-cut loop (where sample L-1 transitions directly into sample L at wrap-around)
   * so looped ambience/thruster/wind tracks NEVER exhibit periodic clicks or reset seams!
   */
  private createSeamlessOverlapLoop(srcBuf: AudioBuffer, crossfadeSec = 1.1): AudioBuffer {
    if (!this.ctx) return srcBuf;
    const sr = srcBuf.sampleRate;
    const trim = Math.min(Math.floor(sr * 0.055), Math.floor(srcBuf.length * 0.05));
    const trimmedLen = srcBuf.length - trim * 2;
    if (trimmedLen < sr * 1.2) return srcBuf;

    const fadeSamples = Math.min(Math.floor(sr * crossfadeSec), Math.floor(trimmedLen * 0.24));
    const outLen = trimmedLen - fadeSamples;
    const outBuf = this.ctx.createBuffer(srcBuf.numberOfChannels, outLen, sr);

    for (let ch = 0; ch < srcBuf.numberOfChannels; ch++) {
      const src = srcBuf.getChannelData(ch);
      const dst = outBuf.getChannelData(ch);
      for (let i = 0; i < fadeSamples; i++) {
        const theta = (i / fadeSamples) * (Math.PI * 0.5);
        const wHead = Math.sin(theta);
        const wTail = Math.cos(theta);
        dst[i] = src[trim + i] * wHead + src[trim + outLen + i] * wTail;
      }
      for (let i = fadeSamples; i < outLen; i++) {
        dst[i] = src[trim + i];
      }
    }
    return outBuf;
  }

  private async decodePrefetchedBuffers(): Promise<void> {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const pending = Array.from(this.rawPrefetched.entries()).filter(
      ([id]) => id !== 'ambient_crt_buzz' && !this.decodedRealAssets.has(id)
    );
    if (pending.length === 0) return;

    await Promise.all(
      pending.map(async ([id, item]) => {
        try {
          const copy = item.data.slice(0);
          const rawDecoded = await ctx.decodeAudioData(copy);
          const finalBuf =
            item.category === 'loop'
              ? this.createSeamlessOverlapLoop(
                  rawDecoded,
                  id === 'alien_eerie_ambience' ? 1.6 : 0.65
                )
              : rawDecoded;

          this.decodedRealAssets.add(id);
          this.buffers.set(id, finalBuf);
          if (item.category === 'sfx') {
            this.bufferOnsets.set(id, this.detectTransientOnsetSec(finalBuf));
          }
          if (item.category === 'loop') {
            this.restartLoopSource(id);
          }
        } catch {
          // Keep procedural fallback only if decoding fails
        }
      })
    );
  }

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  public async unlock(): Promise<void> {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.setupGraph();
      this.buildProceduralLoopFallbacks();
      this.startContinuousLoops();
    }

    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // Will retry on next user gesture
      }
    }
    this.unlocked = this.ctx.state === 'running';

    // Immediately decode homeade_computer_start.m4a so CRT tube ignition plays with zero lag,
    // while decoding the remaining 35 assets in the background!
    await this.ensureBootStartDecoded();

    if (!this.decodePromise) {
      this.decodePromise = (async () => {
        if (this.prefetchPromise) {
          await this.prefetchPromise;
        }
        await this.decodePrefetchedBuffers();
      })();
    }
  }

  private setupGraph(): void {
    const ctx = this.ctx!;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.9;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 64;
    this.analyserData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // 1. Dedicated ASMR Dull Muted Keyboard Bus:
    // Warm low-mid body boost (205Hz) + gentle muffled lowpass (1080Hz) to strip all tinny clickiness
    this.asmrKeyBus = ctx.createGain();
    this.asmrKeyBus.gain.value = 1.0;

    const thockBody = ctx.createBiquadFilter();
    thockBody.type = 'peaking';
    thockBody.frequency.value = 205;
    thockBody.Q.value = 1.1;
    thockBody.gain.value = 5.2;

    const dullLowpass = ctx.createBiquadFilter();
    dullLowpass.type = 'lowpass';
    dullLowpass.frequency.value = 1080;
    dullLowpass.Q.value = 0.65;

    this.asmrKeyBus.connect(thockBody);
    thockBody.connect(dullLowpass);
    dullLowpass.connect(this.masterGain);

    // 2. Authentic 1979 Nostromo Shipboard Intercom Chain (350Hz–3400Hz + soft-clip WaveShaper)
    this.intercomInput = ctx.createGain();
    this.intercomInput.gain.value = 1.0;

    const hp350 = ctx.createBiquadFilter();
    hp350.type = 'highpass';
    hp350.frequency.value = 350;
    hp350.Q.value = 0.85;

    const lp3400 = ctx.createBiquadFilter();
    lp3400.type = 'lowpass';
    lp3400.frequency.value = 3400;
    lp3400.Q.value = 0.9;

    const presencePeak = ctx.createBiquadFilter();
    presencePeak.type = 'peaking';
    presencePeak.frequency.value = 1650;
    presencePeak.Q.value = 1.35;
    presencePeak.gain.value = 3.2;

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.createSoftClipCurve(2.0);
    shaper.oversample = '2x';

    const intercomOut = ctx.createGain();
    intercomOut.gain.value = 0.92;

    this.intercomInput.connect(hp350);
    hp350.connect(lp3400);
    lp3400.connect(presencePeak);
    presencePeak.connect(shaper);
    shaper.connect(intercomOut);
    intercomOut.connect(this.masterGain);
  }

  private createSoftClipCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 1024;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const norm = Math.tanh(drive);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(x * drive) / norm;
    }
    return curve;
  }

  private buildProceduralLoopFallbacks(): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;

    // Dedicated always-active 6.0s turbulent muted combustion rumble buffer (translates on both subwoofers & phone speakers)
    if (!this.buffers.has('muted_flame_rumble_core')) {
      const durSec = 6;
      const len = sr * durSec;
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let brown = 0;
      let lp1 = 0;
      let lp2 = 0;
      const alphaLp = 1 - Math.exp((-2 * Math.PI * 360) / sr);
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        const pink = (b0 + b1 + b2 + white * 0.1848) * 0.16;
        brown = (brown + 0.042 * white) / 1.042;

        // Prime-harmonic loop-periodic combustion chamber flutter (13Hz, 21Hz, 34Hz, 53Hz)
        const u = i / len;
        const tau = Math.PI * 2 * u;
        const chamberFlutter =
          0.78 +
          0.11 * Math.sin(tau * (13 * durSec)) +
          0.09 * Math.sin(tau * (21 * durSec) + 0.7) +
          0.07 * Math.cos(tau * (34 * durSec) + 1.9) +
          0.05 * Math.sin(tau * (53 * durSec) + 2.8);

        // Warm low-frequency hull-coupled combustion resonance (72Hz + 138Hz)
        const hullFlameTone =
          0.09 * Math.sin(tau * (72 * durSec) + Math.sin(tau * (7 * durSec)) * 0.8) +
          0.06 * Math.sin(tau * (138 * durSec) + Math.cos(tau * (11 * durSec)) * 0.6);

        const rawPlume = (brown * 3.1 + pink * 1.15) * chamberFlutter + hullFlameTone;
        const saturated = Math.tanh(rawPlume * 1.55);
        lp1 += alphaLp * (saturated - lp1);
        lp2 += alphaLp * (lp1 - lp2);
        data[i] = lp2 * 0.92;
      }
      this.buffers.set('muted_flame_rumble_core', this.createSeamlessOverlapLoop(buf, 0.55));
    }

    if (!this.buffers.has('thruster_main_loop')) {
      const len = sr * 4;
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let brown = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        const pink = (b0 + b1 + b2 + white * 0.1848) * 0.14;
        brown = (brown + 0.035 * white) / 1.035;
        const t = i / len;
        const rumbleMod =
          0.82 +
          0.12 * Math.sin(2 * Math.PI * 38 * t * 4) +
          0.08 * Math.sin(2 * Math.PI * 71 * t * 4);
        data[i] = Math.tanh((brown * 2.8 + pink * 0.85) * rumbleMod * 1.3);
      }
      this.buffers.set('thruster_main_loop', this.createSeamlessOverlapLoop(buf, 0.35));
    }

    if (!this.buffers.has('thruster_rcs_loop')) {
      const len = Math.floor(sr * 2.5);
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        const hp = white - 0.72 * prev;
        prev = white;
        data[i] = Math.max(-0.95, Math.min(0.95, hp * 0.48));
      }
      this.buffers.set('thruster_rcs_loop', this.createSeamlessOverlapLoop(buf, 0.2));
    }

    if (!this.buffers.has('alien_eerie_ambience')) {
      const len = sr * 12;
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const lfo = 0.72 + 0.28 * Math.sin((2 * Math.PI * t) / 12);
        const d1 = Math.sin(2 * Math.PI * 55 * t) * 0.10;
        const d2 = Math.sin(2 * Math.PI * 77.78 * t + Math.sin((2 * Math.PI * t) / 12) * 0.35) * 0.06;
        const d3 = Math.sin(2 * Math.PI * 164.81 * t) * 0.025;
        data[i] = (d1 + d2 + d3) * lfo;
      }
      this.buffers.set('alien_eerie_ambience', buf);
    }

    if (!this.buffers.has('lv426_wind_loop')) {
      const len = sr * 6;
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const white = Math.random() * 2 - 1;
        const f = 320 + 140 * Math.sin((2 * Math.PI * t) / 6) + 75 * Math.cos((4 * Math.PI * t) / 6);
        const c = 2 * Math.sin((Math.PI * f) / sr);
        const q = 0.09;
        y1 += c * y2;
        const hp = white - y1 - q * y2;
        y2 += c * hp;
        data[i] = Math.tanh(y2 * 0.28 + white * 0.04);
      }
      this.buffers.set('lv426_wind_loop', this.createSeamlessOverlapLoop(buf, 0.5));
    }
  }

  private startContinuousLoops(): void {
    const ctx = this.ctx!;
    if (!this.masterGain) return;

    // Dual-Stage Muted Flame Rumble Bus (warm 80–480Hz combustion body, steep roll-off above ~620Hz = zero hiss!)
    this.mainThrusterFilter = ctx.createBiquadFilter();
    this.mainThrusterFilter.type = 'lowpass';
    this.mainThrusterFilter.frequency.value = 340;
    this.mainThrusterFilter.Q.value = 0.62;

    const subBassShelf = ctx.createBiquadFilter();
    subBassShelf.type = 'lowshelf';
    subBassShelf.frequency.value = 135;
    subBassShelf.gain.value = 5.5;

    const combustionBody = ctx.createBiquadFilter();
    combustionBody.type = 'peaking';
    combustionBody.frequency.value = 195;
    combustionBody.Q.value = 0.85;
    combustionBody.gain.value = 5.0;

    this.mainThrusterPostLp = ctx.createBiquadFilter();
    this.mainThrusterPostLp.type = 'lowpass';
    this.mainThrusterPostLp.frequency.value = 560;
    this.mainThrusterPostLp.Q.value = 0.54;

    this.mainThrusterGain = ctx.createGain();
    this.mainThrusterGain.gain.value = 0;

    this.mainThrusterFilter.connect(subBassShelf);
    subBassShelf.connect(combustionBody);
    combustionBody.connect(this.mainThrusterPostLp);
    this.mainThrusterPostLp.connect(this.mainThrusterGain);
    this.mainThrusterGain.connect(this.masterGain);

    // Start dedicated turbulent muted combustion core + sample texture layer
    const coreBuf = this.buffers.get('muted_flame_rumble_core');
    if (coreBuf) {
      const coreSrc = ctx.createBufferSource();
      coreSrc.buffer = coreBuf;
      coreSrc.loop = true;
      coreSrc.playbackRate.value = 0.92;
      const coreMix = ctx.createGain();
      coreMix.gain.value = 0.88;
      coreSrc.connect(coreMix);
      coreMix.connect(this.mainThrusterFilter);
      coreSrc.start();
      this.synthFlameRumbleSource = coreSrc;
    }
    this.restartLoopSource('thruster_main_loop');

    this.rcsFilter = ctx.createBiquadFilter();
    this.rcsFilter.type = 'bandpass';
    this.rcsFilter.frequency.value = 2600;
    this.rcsFilter.Q.value = 0.65;

    this.rcsPanner = ctx.createStereoPanner();
    this.rcsPanner.pan.value = 0;

    this.rcsGain = ctx.createGain();
    this.rcsGain.gain.value = 0;

    this.rcsFilter.connect(this.rcsPanner);
    this.rcsPanner.connect(this.rcsGain);
    this.rcsGain.connect(this.masterGain);
    this.restartLoopSource('thruster_rcs_loop');

    // Continuous, non-repeating 1979 ALIEN deep-space ambience (replaces old static CRT buzz!)
    this.startAlienDeepSpaceAmbience();

    // Seamlessly crossfaded & low-passed (480Hz, zero hiss/static) hull resonance layer
    this.eerieAmbienceFilter = ctx.createBiquadFilter();
    this.eerieAmbienceFilter.type = 'lowpass';
    this.eerieAmbienceFilter.frequency.value = 480;
    this.eerieAmbienceFilter.Q.value = 0.65;

    this.eerieAmbienceGain = ctx.createGain();
    this.eerieAmbienceGain.gain.value = 0.11;
    this.eerieAmbienceFilter.connect(this.eerieAmbienceGain);
    this.eerieAmbienceGain.connect(this.masterGain);
    this.restartLoopSource('alien_eerie_ambience');

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 950;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    this.restartLoopSource('lv426_wind_loop');
  }

  /**
   * Infinite, non-repeating 1979 ALIEN ("Nostromo in Deep Space") synthesizer bed:
   * Uses prime-ratio ultra-slow LFOs (21s, 29s, 37s, 43s) modulating deep cosmic fifths,
   * distant hollow minor/tritone hull harmonics, and stereo drift — zero static, zero loop seams.
   */
  private startAlienDeepSpaceAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    this.deepSpaceBusGain = ctx.createGain();
    this.deepSpaceBusGain.gain.value = 0.16;
    this.deepSpaceBusGain.connect(this.masterGain);

    // 1. Deep Cosmic Void Sub-Fifth (D1 36.71Hz + A1 55.00Hz)
    const sub1 = ctx.createOscillator();
    const sub2 = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub1.type = 'sine';
    sub2.type = 'sine';
    sub1.frequency.value = 36.71;
    sub2.frequency.value = 55.04;
    subGain.gain.value = 0.24;

    const subLfo = ctx.createOscillator();
    const subLfoGain = ctx.createGain();
    subLfo.type = 'sine';
    subLfo.frequency.value = 0.034; // ~29.4s breath
    subLfoGain.gain.value = 0.07;
    subLfo.connect(subLfoGain);
    subLfoGain.connect(subGain.gain);

    sub1.connect(subGain);
    sub2.connect(subGain);
    subGain.connect(this.deepSpaceBusGain);
    sub1.start();
    sub2.start();
    subLfo.start();

    // 2. Haunting Jerry Goldsmith / Alan Splet Deep-Space Harmonic Shimmer (incommensurate LFOs)
    const voices = [
      { freq: 82.41, lfoHz: 0.047, pan: -0.35, amp: 0.09 }, // E2
      { freq: 116.54, lfoHz: 0.027, pan: 0.35, amp: 0.065 }, // Bb2 eerie tritone
      { freq: 164.81, lfoHz: 0.021, pan: -0.18, amp: 0.045 }, // E3 hollow fifth
      { freq: 220.0, lfoHz: 0.017, pan: 0.22, amp: 0.028 }, // A3 distant starlight
    ];

    for (const v of voices) {
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const vGain = ctx.createGain();
      const panner = ctx.createStereoPanner();

      osc.type = 'triangle';
      osc.frequency.value = v.freq;

      // Tiny slow pitch drift (+/- 0.35 Hz) for organic tape-flutter space warmth
      const pitchLfo = ctx.createOscillator();
      const pitchDepth = ctx.createGain();
      pitchLfo.type = 'sine';
      pitchLfo.frequency.value = v.lfoHz * 1.37;
      pitchDepth.gain.value = 0.35;
      pitchLfo.connect(pitchDepth);
      pitchDepth.connect(osc.frequency);

      lp.type = 'lowpass';
      lp.frequency.value = 290;
      lp.Q.value = 1.4;

      const filterLfo = ctx.createOscillator();
      const filterDepth = ctx.createGain();
      filterLfo.type = 'sine';
      filterLfo.frequency.value = v.lfoHz;
      filterDepth.gain.value = 115;
      filterLfo.connect(filterDepth);
      filterDepth.connect(lp.frequency);

      vGain.gain.value = v.amp;
      const ampLfo = ctx.createOscillator();
      const ampDepth = ctx.createGain();
      ampLfo.type = 'sine';
      ampLfo.frequency.value = v.lfoHz * 0.79;
      ampDepth.gain.value = v.amp * 0.65;
      ampLfo.connect(ampDepth);
      ampDepth.connect(vGain.gain);

      panner.pan.value = v.pan;

      osc.connect(lp);
      lp.connect(vGain);
      vGain.connect(panner);
      panner.connect(this.deepSpaceBusGain);

      osc.start();
      pitchLfo.start();
      filterLfo.start();
      ampLfo.start();
    }

    // 3. Sparse, non-repeating 1979 ALIEN lonely deep-space ionosphere / cosmic hull swells
    const cosmicHarmonics = [110.0, 130.81, 146.83, 155.56, 196.0, 233.08, 293.66];
    const scheduleDeepSpaceSwell = (): void => {
      if (!this.ctx || !this.deepSpaceBusGain) return;
      if (this.ctx.state === 'running' && !this.muted) {
        const now = this.ctx.currentTime;
        const dur = 5.5 + Math.random() * 3.5;
        const baseFreq =
          cosmicHarmonics[Math.floor(Math.random() * cosmicHarmonics.length)] ?? 146.83;
        const driftRatio = Math.random() < 0.5 ? 0.986 : 1.014;

        const oscA = this.ctx.createOscillator();
        const oscB = this.ctx.createOscillator();
        const lp = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();
        const pan = this.ctx.createStereoPanner();

        oscA.type = 'sine';
        oscB.type = 'triangle';
        oscA.frequency.setValueAtTime(baseFreq, now);
        oscA.frequency.linearRampToValueAtTime(baseFreq * driftRatio, now + dur);
        oscB.frequency.setValueAtTime(baseFreq * 1.502, now);
        oscB.frequency.linearRampToValueAtTime(baseFreq * 1.502 * driftRatio, now + dur);

        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(220, now);
        lp.frequency.linearRampToValueAtTime(420, now + dur * 0.45);
        lp.frequency.linearRampToValueAtTime(180, now + dur);
        lp.Q.value = 2.2;

        const startPan = (Math.random() * 2 - 1) * 0.6;
        pan.pan.setValueAtTime(startPan, now);
        pan.pan.linearRampToValueAtTime(-startPan * 0.7, now + dur);

        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.042, now + dur * 0.42);
        env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        const subMix = this.ctx.createGain();
        subMix.gain.value = 0.35;

        oscA.connect(lp);
        oscB.connect(subMix);
        subMix.connect(lp);
        lp.connect(env);
        env.connect(pan);
        pan.connect(this.deepSpaceBusGain);

        oscA.start(now);
        oscB.start(now);
        oscA.stop(now + dur + 0.05);
        oscB.stop(now + dur + 0.05);
      }

      const nextDelayMs = (9.5 + Math.random() * 8.5) * 1000;
      window.setTimeout(scheduleDeepSpaceSwell, nextDelayMs);
    };

    window.setTimeout(scheduleDeepSpaceSwell, 4500);
  }

  private restartLoopSource(id: string): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !buf) return;

    const makeSource = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      return src;
    };

    if (id === 'thruster_main_loop' && this.mainThrusterFilter) {
      try {
        this.mainThrusterSource?.stop();
      } catch {
        /* ignore */
      }
      this.mainThrusterSource = makeSource();
      this.mainThrusterSource.playbackRate.value = 0.84;
      const sampleMix = ctx.createGain();
      sampleMix.gain.value = 0.62;
      this.mainThrusterSource.connect(sampleMix);
      sampleMix.connect(this.mainThrusterFilter);
      this.mainThrusterSource.start();
    } else if (id === 'thruster_rcs_loop' && this.rcsFilter) {
      try {
        this.rcsThrusterSource?.stop();
      } catch {
        /* ignore */
      }
      this.rcsThrusterSource = makeSource();
      this.rcsThrusterSource.connect(this.rcsFilter);
      this.rcsThrusterSource.start();
    } else if (id === 'alien_eerie_ambience' && this.eerieAmbienceFilter) {
      try {
        this.eerieAmbienceSource?.stop();
      } catch {
        /* ignore */
      }
      this.eerieAmbienceSource = makeSource();
      this.eerieAmbienceSource.playbackRate.value = 0.78;
      this.eerieAmbienceSource.connect(this.eerieAmbienceFilter);
      this.eerieAmbienceSource.start();
    } else if (id === 'lv426_wind_loop' && this.windFilter) {
      try {
        this.windSource?.stop();
      } catch {
        /* ignore */
      }
      this.windSource = makeSource();
      this.windSource.connect(this.windFilter);
      this.windSource.start();
    }
  }

  private setSmoothParam(param: AudioParam | undefined | null, value: number): void {
    if (!param || !this.ctx) return;
    if (Math.abs(param.value - value) < 0.0004) return;
    param.cancelScheduledValues(this.ctx.currentTime);
    param.value = value;
  }

  public updateFlightDsp(
    throttle: number,
    rcsDirection: number,
    rcsIntensity: number,
    windSpeedMps: number,
    flightActive: boolean,
    caveDarkness = 0,
    dt = 1 / 60
  ): void {
    if (!this.ctx || !this.unlocked) return;

    const clampedDt = Math.max(0.001, Math.min(0.1, dt));
    const fastK = 1 - Math.exp(-clampedDt * 20);
    const medK = 1 - Math.exp(-clampedDt * 9);
    const slowK = 1 - Math.exp(-clampedDt * 2.5);

    // Tastefully swell deep-space & eerie hull resonance inside dark caverns
    const targetEerie = 0.09 + caveDarkness * 0.09;
    const targetSpace = 0.15 + caveDarkness * 0.06;
    this.curEerieGain += (targetEerie - this.curEerieGain) * slowK;
    this.curSpaceGain += (targetSpace - this.curSpaceGain) * slowK;
    this.setSmoothParam(this.eerieAmbienceGain?.gain, this.curEerieGain);
    this.setSmoothParam(this.deepSpaceBusGain?.gain, this.curSpaceGain);

    if (!flightActive) {
      this.curMainFlameGain += (0 - this.curMainFlameGain) * fastK;
      this.curRcsGain += (0 - this.curRcsGain) * fastK;
      this.curWindGain += (0 - this.curWindGain) * medK;
      this.setSmoothParam(this.mainThrusterGain?.gain, this.curMainFlameGain < 0.002 ? 0 : this.curMainFlameGain);
      this.setSmoothParam(this.rcsGain?.gain, this.curRcsGain < 0.002 ? 0 : this.curRcsGain);
      this.setSmoothParam(this.windGain?.gain, this.curWindGain < 0.002 ? 0 : this.curWindGain);
      return;
    }

    // Sustained Muted Flame Rumble: warm muffled combustion roar (280Hz..650Hz) with zero harsh hiss
    const clampedNorm = Math.max(0, Math.min(1, throttle));
    const overdriveExtra = Math.max(0, throttle - 1);
    const targetRate = 0.78 + clampedNorm * 0.22 + overdriveExtra * 0.10;
    const targetCutoff = 280 + Math.pow(clampedNorm, 0.9) * 340 + overdriveExtra * 190;
    const targetPostCutoff = 480 + clampedNorm * 210 + overdriveExtra * 160;
    const targetMainGain =
      throttle > 0.01 ? Math.min(0.92, 0.36 + clampedNorm * 0.44 + overdriveExtra * 0.14) : 0;

    this.curMainFlameRate += (targetRate - this.curMainFlameRate) * fastK;
    this.curMainFlameCutoff += (targetCutoff - this.curMainFlameCutoff) * fastK;
    this.curMainFlameGain += (targetMainGain - this.curMainFlameGain) * fastK;

    this.setSmoothParam(this.mainThrusterSource?.playbackRate, this.curMainFlameRate);
    this.setSmoothParam(this.synthFlameRumbleSource?.playbackRate, this.curMainFlameRate * 0.96);
    this.setSmoothParam(this.mainThrusterFilter?.frequency, this.curMainFlameCutoff);
    this.setSmoothParam(this.mainThrusterPostLp?.frequency, targetPostCutoff);
    this.setSmoothParam(
      this.mainThrusterGain?.gain,
      this.curMainFlameGain < 0.002 ? 0 : this.curMainFlameGain
    );

    const targetPan = Math.max(-0.6, Math.min(0.6, rcsDirection * 0.52));
    const targetRcsGain = rcsIntensity > 0.01 ? Math.min(0.38, rcsIntensity * 0.30) : 0;
    this.curRcsPan += (targetPan - this.curRcsPan) * fastK;
    this.curRcsGain += (targetRcsGain - this.curRcsGain) * fastK;
    this.setSmoothParam(this.rcsPanner?.pan, this.curRcsPan);
    this.setSmoothParam(this.rcsGain?.gain, this.curRcsGain < 0.002 ? 0 : this.curRcsGain);

    const windNorm = Math.min(1, windSpeedMps / 14);
    const targetWindGain = windNorm * 0.34;
    const targetWindFreq = 420 + windNorm * 1350;
    this.curWindGain += (targetWindGain - this.curWindGain) * medK;
    this.curWindFreq += (targetWindFreq - this.curWindFreq) * medK;
    this.setSmoothParam(this.windGain?.gain, this.curWindGain < 0.002 ? 0 : this.curWindGain);
    this.setSmoothParam(this.windFilter?.frequency, this.curWindFreq);
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public suspendForBackground(paused: boolean): void {
    if (!this.ctx) return;
    if (paused && this.ctx.state === 'running') {
      void this.ctx.suspend();
    } else if (!paused && this.ctx.state === 'suspended' && this.unlocked) {
      void this.ctx.resume();
    }
  }

  public getBusActivityLevel(): number {
    if (this.muted || !this.analyser || !this.analyserData || !this.unlocked) return 0;
    this.analyser.getByteFrequencyData(this.analyserData);
    let sum = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      sum += this.analyserData[i];
    }
    return Math.min(1, sum / (this.analyserData.length * 115));
  }

  /**
   * Plays `homeade_computer_start.m4a` simultaneously with the distorted 1979 CRT
   * tube turn-on flash (completely replacing the old `screen_power_on.mp3`).
   */
  public playAlienBootAwakening(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const startBuf = this.buffers.get('homeade_computer_start');
    if (startBuf) {
      try {
        this.bootStartupSource?.stop();
      } catch {
        /* ignore */
      }
      const src = this.ctx.createBufferSource();
      src.buffer = startBuf;
      src.playbackRate.value = 1.0;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.96, now);
      src.connect(gain);
      gain.connect(this.masterGain);
      src.start(now, 0);

      this.bootStartupSource = src;
      this.bootStartupGain = gain;
      src.onended = () => {
        if (this.bootStartupSource === src) {
          this.bootStartupSource = null;
          this.bootStartupGain = null;
        }
      };
      return;
    }

    if (!this.muted) {
      this.synthScreenPowerOn(now, 0.75);
    }
  }

  /**
   * Smoothly fades out the startup computer audio once active drop-shuttle flight engages.
   */
  public fadeOutBootStartupAudio(fadeSec = 1.1): void {
    if (!this.ctx || !this.bootStartupSource || !this.bootStartupGain) return;
    const now = this.ctx.currentTime;
    const src = this.bootStartupSource;
    const g = this.bootStartupGain;
    this.bootStartupSource = null;
    this.bootStartupGain = null;

    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
    window.setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* ignore */
      }
    }, Math.ceil((fadeSec + 0.1) * 1000));
  }

  /**
   * Plays lower-pitched, warm, infrequent 1979 Nostromo computer thinking tones.
   */
  public playAlienComputerActivity(intensity = 0.45): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.buffers.has('computer_telemetry_chirp')) {
      this.playLowComputerBuffer(
        'computer_telemetry_chirp',
        intensity * 0.85,
        0.62 + Math.random() * 0.14
      );
    } else if (this.buffers.has('tape_drive_servo')) {
      this.playLowComputerBuffer(
        'tape_drive_servo',
        intensity * 0.7,
        0.78 + Math.random() * 0.12
      );
    } else {
      this.synth1979MainframeCascade(this.ctx.currentTime, 3, intensity * 0.42);
    }
  }

  private playLowComputerBuffer(id: string, volume: number, pitch: number): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !buf || !this.masterGain) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;

    // Warm 780Hz lowpass so computer bleeps are deep, dark, and never piercing
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 780;
    lp.Q.value = 0.7;

    const g = ctx.createGain();
    g.gain.value = 0.68 * volume;

    src.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);
    src.start(ctx.currentTime);
  }

  /**
   * Satisfying heavy mechanical / industrial cockpit latch engaging sound for buttons & switches.
   */
  /**
   * Classic 1979 ALIEN Motion Tracker Proximity Ping for Landing Sequence:
   * Hollow, slightly creepy electromechanical pulse + faint solenoid flutter whose
   * repetition rate and tension rise smoothly as the lander nears the ground.
   * @param closeness 0.0 (far ~68m AGL) to 1.0 (contact imminent <3m AGL)
   */
  public playAlienMotionTrackerPing(closeness: number, pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const c = Math.max(0, Math.min(1, closeness));

    // 1. Subtle mechanical Ash-tracker micro-flutter tick 22ms before pulse
    const tickOsc = ctx.createOscillator();
    const tickGain = ctx.createGain();
    tickOsc.type = 'triangle';
    tickOsc.frequency.setValueAtTime(340 + c * 90, now);
    tickOsc.frequency.exponentialRampToValueAtTime(110, now + 0.016);
    tickGain.gain.setValueAtTime(0.08 + c * 0.06, now);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
    tickOsc.connect(tickGain);
    tickGain.connect(this.masterGain);
    tickOsc.start(now);
    tickOsc.stop(now + 0.02);

    // 2. Layer ElevenLabs alien_motion_ping buffer (if loaded) + signature hollow 1979 resonant FM blip
    const buf = this.buffers.get('alien_motion_ping');
    if (buf) {
      const onset = this.bufferOnsets.get('alien_motion_ping') ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.86 + c * 0.24;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1120 + c * 320;
      bp.Q.value = 1.6;

      const env = ctx.createGain();
      const vol = 0.22 + c * 0.24;
      env.gain.setValueAtTime(0.001, now + 0.02);
      env.gain.linearRampToValueAtTime(vol, now + 0.028);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.5, Math.min(0.5, pan));

      src.connect(bp);
      bp.connect(env);
      env.connect(panner);
      panner.connect(this.masterGain);
      src.start(now + 0.02, onset, 0.26);
    }

    // Hollow 1979 movie motion-tracker resonant carrier (gives that exact eerie metallic ring)
    const ping = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    const pingEnv = ctx.createGain();

    const baseF = 935 + c * 215;
    ping.type = 'sine';
    ping.frequency.setValueAtTime(baseF * 1.04, now + 0.022);
    ping.frequency.exponentialRampToValueAtTime(baseF * 0.96, now + 0.16);

    mod.type = 'sine';
    mod.frequency.value = 58; // Creepy 58Hz warble flutter inside the blip!
    modG.gain.value = 18 + c * 14;

    pingEnv.gain.setValueAtTime(0.0001, now + 0.022);
    pingEnv.gain.linearRampToValueAtTime(0.11 + c * 0.11, now + 0.030);
    pingEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    mod.connect(modG);
    modG.connect(ping.frequency);
    ping.connect(pingEnv);
    pingEnv.connect(this.masterGain);

    mod.start(now + 0.022);
    ping.start(now + 0.022);
    mod.stop(now + 0.18);
    ping.stop(now + 0.18);
  }

  /**
   * EPIC Solid-Rocket Emergency Thrust Pulse ([SPACEBAR]):
   * Explosive pyrotechnic ignition + chest-shaking sub-bass rocket blast wave.
   */
  public playEmergencyThrustPulse(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const buf = this.buffers.get('emergency_thrust_pulse');
    if (buf) {
      const onset = this.bufferOnsets.get('emergency_thrust_pulse') ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.92;

      const subShelf = ctx.createBiquadFilter();
      subShelf.type = 'lowshelf';
      subShelf.frequency.value = 120;
      subShelf.gain.value = 6.5;

      const g = ctx.createGain();
      g.gain.setValueAtTime(1.0, now);

      src.connect(subShelf);
      subShelf.connect(g);
      g.connect(this.masterGain);
      src.start(now, onset);
    } else {
      this.synthHullExplosion(now, 0.85);
    }
  }

  /**
   * Definitive, weighty multi-ton industrial spaceship touchdown "THUD":
   * Layers the HD heavy landing thud sample (+8dB sub-bass shelf), a phase-locked
   * structural hull shock transient (118Hz -> 29Hz), and delayed hydraulic clamp lock (+80ms).
   */
  private lastTouchdownThudTime = -10;
  public playIndustrialTouchdownThud(impactVs: number, isHard: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastTouchdownThudTime < 0.35) return;
    this.lastTouchdownThudTime = now;

    const ctx = this.ctx;
    const velScale = Math.max(0.72, Math.min(1.15, 0.72 + impactVs / 3.8));

    // 1. Primary HD Heavy Industrial Thud Sample (onset-trimmed + sub-bass boosted)
    const thudBuf = this.buffers.get('landing_hard_thud');
    if (thudBuf) {
      const onset = this.bufferOnsets.get('landing_hard_thud') ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = thudBuf;
      src.playbackRate.value = isHard ? 0.86 : 0.93;

      const subShelf = ctx.createBiquadFilter();
      subShelf.type = 'lowshelf';
      subShelf.frequency.value = 98;
      subShelf.gain.value = 8.0;

      const hullBody = ctx.createBiquadFilter();
      hullBody.type = 'peaking';
      hullBody.frequency.value = 175;
      hullBody.Q.value = 1.1;
      hullBody.gain.value = 4.2;

      const g = ctx.createGain();
      g.gain.setValueAtTime((isHard ? 1.0 : 0.88) * velScale, now);

      src.connect(subShelf);
      subShelf.connect(hullBody);
      hullBody.connect(g);
      g.connect(this.masterGain);
      src.start(now, onset);
    }

    // 2. Phase-Locked Physical Multi-Ton Sub-Bass Hull Drop + Damped Steel Deck Slam
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(isHard ? 128 : 112, now);
    subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.29);
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.68 * velScale, now + 0.006);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.36);

    const crunchLen = Math.floor(ctx.sampleRate * 0.14);
    const crunchBuf = ctx.createBuffer(1, crunchLen, ctx.sampleRate);
    const cd = crunchBuf.getChannelData(0);
    for (let i = 0; i < crunchLen; i++) {
      const env = Math.exp(-i / (ctx.sampleRate * 0.028));
      cd[i] = (Math.random() * 2 - 1) * env;
    }
    const crunchSrc = ctx.createBufferSource();
    crunchSrc.buffer = crunchBuf;
    const crunchLp = ctx.createBiquadFilter();
    crunchLp.type = 'lowpass';
    crunchLp.frequency.value = isHard ? 520 : 380;
    const crunchGain = this.createGainWithMaster(0.55 * velScale);
    crunchSrc.connect(crunchLp);
    crunchLp.connect(crunchGain);
    crunchSrc.start(now);

    // 3. Delayed (+80ms) Pneumatic Strut Compression & Magnetic Clamp Lock
    const mechBuf = this.buffers.get('landing_soft_mech');
    if (mechBuf) {
      const onset = this.bufferOnsets.get('landing_soft_mech') ?? 0;
      const mSrc = ctx.createBufferSource();
      mSrc.buffer = mechBuf;
      mSrc.playbackRate.value = 0.92;
      const mGain = this.createGainWithMaster(0.66);
      mSrc.connect(mGain);
      mSrc.start(now + 0.08, onset);
    }

    const latchBuf = this.buffers.get('button_latch_lock');
    if (latchBuf) {
      const onset = this.bufferOnsets.get('button_latch_lock') ?? 0;
      const lSrc = ctx.createBufferSource();
      lSrc.buffer = latchBuf;
      lSrc.playbackRate.value = 0.72;
      const lGain = this.createGainWithMaster(0.72);
      lSrc.connect(lGain);
      lSrc.start(now + 0.095, onset);
    }
  }

  /**
   * Scary, ominous 1979 computer transition sound effects replacing non-warning voice intros/transitions.
   */
  public playScaryComputerTransition(
    kind: 'dark' | 'engage' | 'confirm',
    delaySeconds = 0,
    gainVal = 0.82
  ): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const startAt = this.ctx.currentTime + Math.max(0, delaySeconds);
    const idMap: Record<'dark' | 'engage' | 'confirm', SfxId> = {
      dark: 'computer_transition_dark',
      engage: 'computer_sector_engage',
      confirm: 'computer_touchdown_confirm',
    };
    const id = idMap[kind];
    const buf = this.buffers.get(id);
    if (buf) {
      const onset = this.bufferOnsets.get(id) ?? 0;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = kind === 'dark' ? 0.88 : 0.92;

      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1850;

      const sub = this.ctx.createBiquadFilter();
      sub.type = 'lowshelf';
      sub.frequency.value = 110;
      sub.gain.value = 4.5;

      const g = this.createGainWithMaster(gainVal);
      src.connect(lp);
      lp.connect(sub);
      sub.connect(g);
      src.start(startAt, onset);
    } else {
      this.synth1979MainframeCascade(startAt, 6, 0.45);
    }
  }

  private createGainWithMaster(val: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = val;
    g.connect(this.masterGain!);
    return g;
  }

  /**
   * Soft, warm, muted flight-deck indicator pulse whenever bottom Airbus warnings are active.
   * Heavily low-passed (620-760 Hz) with rounded envelopes so it adds tactile cockpit awareness
   * without ever sounding shrill or fatiguing.
   */
  public playMutedAvionicsIndicatorBeep(isCritical: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = isCritical ? 740 : 580;
    lp.Q.value = 0.7;
    lp.connect(this.masterGain);

    if (isCritical) {
      // Muted dual-tone Airbus-style low chime (420 Hz -> 335 Hz)
      const notes = [
        { freq: 420, offset: 0, dur: 0.075 },
        { freq: 335, offset: 0.088, dur: 0.095 },
      ];
      for (const n of notes) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.freq, now + n.offset);
        g.gain.setValueAtTime(0.0001, now + n.offset);
        g.gain.linearRampToValueAtTime(0.19, now + n.offset + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, now + n.offset + n.dur);
        osc.connect(g);
        g.connect(lp);
        osc.start(now + n.offset);
        osc.stop(now + n.offset + n.dur + 0.015);
      }
    } else {
      // Soft single muted amber caution pulse (330 Hz)
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(312, now + 0.11);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.14, now + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.115);
      osc.connect(g);
      g.connect(lp);
      osc.start(now);
      osc.stop(now + 0.13);
    }
  }

  public playButtonLatchLock(pitch = 0.94, volume = 0.95): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.buffers.has('button_latch_lock')) {
      this.playSfx('button_latch_lock', {
        pitch: pitch * (0.96 + Math.random() * 0.08),
        volume,
      });
    } else {
      this.playSfx('keypress_return', { pitch: pitch * 0.85, volume });
    }
  }

  /**
   * Dedicated ASMR dull, muted, cushioned PBT mechanical keyboard clack for scrolling text.
   * Alternates samples, trims leading silence, pitches down slightly for deep thock,
   * shapes a clean 115ms envelope, and routes through the 1080Hz dampened ASMR filter bus.
   */
  public playAsmrScrollClack(volume = 0.78): void {
    if (!this.ctx || !this.asmrKeyBus || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastKeyclickTime < 0.036) return;
    this.lastKeyclickTime = now;

    this.keyAltToggle = !this.keyAltToggle;
    const chosenId =
      this.keyAltToggle && this.buffers.has('ui_keyclick_alt')
        ? 'ui_keyclick_alt'
        : 'ui_keyclick';

    const buf = this.buffers.get(chosenId);
    const pitch = 0.76 + Math.random() * 0.18; // Lower pitch = deeper, duller, cushiony thock

    if (buf) {
      const onset = this.bufferOnsets.get(chosenId) ?? 0;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = pitch;

      const env = this.ctx.createGain();
      const dur = 0.125;
      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.95 * volume, now + 0.005);
      env.gain.exponentialRampToValueAtTime(0.001, now + dur);

      const pan = this.ctx.createStereoPanner();
      pan.pan.value = (Math.random() - 0.5) * 0.18;

      src.connect(env);
      env.connect(pan);
      pan.connect(this.asmrKeyBus);
      src.start(now, onset, dur + 0.03);
    } else {
      this.synthAsmrDullThock(now, pitch, volume);
    }
  }

  public playSfx(id: SfxId, options?: { pitch?: number; pan?: number; volume?: number }): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    if (id === 'ui_keyclick' || id === 'ui_keyclick_alt') {
      this.playAsmrScrollClack(options?.volume ?? 0.82);
      return;
    }

    const now = this.ctx.currentTime;
    if (id === 'proximity_klaxon') {
      if (now - this.lastKlaxonTime < 0.38) return;
      this.lastKlaxonTime = now;
    }

    const pitch = options?.pitch ?? 1.0;
    const pan = options?.pan ?? 0;
    const volume = options?.volume ?? 1.0;

    const lookupKey =
      id === 'ui_toggle_switch' && !this.buffers.has('ui_toggle_switch')
        ? 'keypress_return'
        : id;
    const loadedBuf = this.buffers.get(lookupKey);

    if (loadedBuf) {
      const onset = this.bufferOnsets.get(lookupKey) ?? 0;
      const src = this.ctx.createBufferSource();
      src.buffer = loadedBuf;
      src.playbackRate.value = pitch;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.74 * volume;

      if (pan !== 0) {
        const panner = this.ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        src.connect(panner);
        panner.connect(gain);
      } else {
        src.connect(gain);
      }
      gain.connect(this.masterGain);
      // Start near transient onset for crisp response on snappy mechanical switches
      const startOffset =
        lookupKey === 'button_latch_lock' ||
        lookupKey === 'keypress_return' ||
        lookupKey === 'thruster_ignite' ||
        lookupKey === 'landing_hard_thud' ||
        lookupKey === 'landing_soft_mech'
          ? onset
          : 0;
      src.start(now, startOffset);
      return;
    }

    switch (id) {
      case 'homeade_computer_start':
        this.synthScreenPowerOn(now, volume);
        break;
      case 'nostromo_boot_sequence':
      case 'computer_telemetry_chirp':
      case 'tape_drive_servo':
        this.synth1979MainframeCascade(now, 5, volume * 0.4);
        break;
      case 'button_latch_lock':
      case 'keypress_return':
      case 'ui_toggle_switch':
        this.synthToggleSwitch(now, pitch * 0.8, volume);
        break;
      case 'thruster_ignite':
        this.synthLandingThud(now, 0.7, volume * 0.6);
        break;
      case 'emergency_thrust_pulse':
        this.synthHullExplosion(now, volume * 0.85);
        break;
      case 'computer_transition_dark':
      case 'computer_sector_engage':
      case 'computer_touchdown_confirm':
        this.synth1979MainframeCascade(now, 6, volume * 0.45);
        break;
      case 'lidar_ping':
        this.synthLidarPing(now, pitch, pan, volume);
        break;
      case 'alien_motion_ping':
        this.playAlienMotionTrackerPing(0.5, pan);
        break;
      case 'proximity_klaxon':
        this.synthProximityKlaxon(now, pitch, volume);
        break;
      case 'landing_soft_mech':
      case 'landing_hard_thud':
      case 'landing_strut_thud':
        this.synthLandingThud(now, pitch, volume);
        break;
      case 'hull_explosion':
        this.synthHullExplosion(now, volume);
        break;
    }
  }

  public playVoiceCallout(id: VoiceCalloutId, force = false): void {
    if (!this.ctx || !this.intercomInput || this.muted) return;
    const now = this.ctx.currentTime;
    if (!force && now - this.lastVoiceTime < 2.2) return;
    this.lastVoiceTime = now;

    try {
      this.activeVoiceSource?.stop();
    } catch {
      /* ignore */
    }

    this.synthIntercomPreChime(now);

    const voiceBuf = this.buffers.get(id);
    if (voiceBuf) {
      const src = this.ctx.createBufferSource();
      src.buffer = voiceBuf;
      src.connect(this.intercomInput);
      src.start(now + 0.22);
      this.activeVoiceSource = src;
    } else {
      this.synthMuthurTelemetryCadence(now + 0.22, id);
    }
  }

  /**
   * Synthesizes muted 1979 ALIEN ("Mother" / Mn7A1vfs8m0) rhythmic analog mainframe
   * telemetry bleeps routed through the warm band-limited cockpit speaker chain.
   */
  private synth1979MainframeCascade(t: number, steps = 9, gainScale = 0.36): void {
    const ctx = this.ctx!;
    const dest = this.intercomInput ?? this.masterGain!;
    // Deep low-register baritone 1979 mainframe telemetry tones (146Hz - 329Hz)
    const registers = [164.8, 220.0, 246.9, 196.0, 293.7, 146.8, 261.6, 329.6];

    let cursor = t;
    for (let i = 0; i < steps; i++) {
      const dur = i % 3 === 2 ? 0.11 : 0.065;
      const gap = i % 4 === 3 ? 0.16 : 0.085;
      const freq = registers[(i * 3 + Math.floor(i / 2)) % registers.length];

      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, cursor);

      lp.type = 'lowpass';
      lp.frequency.value = 680;

      g.gain.setValueAtTime(0.0001, cursor);
      g.gain.linearRampToValueAtTime(0.11 * gainScale, cursor + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, cursor + dur);

      osc.connect(lp);
      lp.connect(g);
      g.connect(dest);

      osc.start(cursor);
      osc.stop(cursor + dur + 0.005);
      cursor += gap;
    }
  }

  /**
   * Warm, dull, muted PBT keycap bottom-out fallback synthesizer (zero bright click).
   */
  private synthAsmrDullThock(t: number, pitch: number, volume: number): void {
    const ctx = this.ctx!;
    // Low cushioned plastic housing thump (195Hz -> 58Hz)
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(195 * pitch, t);
    body.frequency.exponentialRampToValueAtTime(56 * pitch, t + 0.038);

    bodyGain.gain.setValueAtTime(0.28 * volume, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.046);

    body.connect(bodyGain);
    bodyGain.connect(this.asmrKeyBus!);
    body.start(t);
    body.stop(t + 0.05);

    // Soft muted felt/PBT impact transient (filtered below 750Hz)
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 0.025);
    const nBuf = ctx.createBuffer(1, len, sr);
    const d = nBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.006));
    }
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = nBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 720 * pitch;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.24 * volume;

    nSrc.connect(lp);
    lp.connect(nGain);
    nGain.connect(this.asmrKeyBus!);
    nSrc.start(t);
  }

  private synthScreenPowerOn(t: number, volume: number): void {
    const ctx = this.ctx!;
    this.synthToggleSwitch(t, 0.85, volume);
    const whine = ctx.createOscillator();
    const g = ctx.createGain();
    whine.type = 'sine';
    whine.frequency.setValueAtTime(1800, t + 0.05);
    whine.frequency.exponentialRampToValueAtTime(9800, t + 1.1);
    g.gain.setValueAtTime(0.0001, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.08 * volume, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    whine.connect(g);
    g.connect(this.masterGain!);
    whine.start(t + 0.05);
    whine.stop(t + 1.25);
  }

  private synthIntercomPreChime(t: number): void {
    const ctx = this.ctx!;
    const dest = this.intercomInput!;
    const freqs = [440, 554.37];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const start = t + idx * 0.09;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.14, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.095);
      osc.connect(g);
      g.connect(dest);
      osc.start(start);
      osc.stop(start + 0.105);
    });
  }

  private synthMuthurTelemetryCadence(t: number, id: VoiceCalloutId): void {
    const ctx = this.ctx!;
    const dest = this.intercomInput!;
    const seed = id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const baseFreq = id === 'voice_hull_breach' ? 520 : id === 'voice_touchdown' ? 780 : 660;
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = baseFreq + ((seed + i * 37) % 5) * 75;
      const start = t + i * 0.055;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.11, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.048);
      osc.connect(g);
      g.connect(dest);
      osc.start(start);
      osc.stop(start + 0.052);
    }
  }

  private synthToggleSwitch(t: number, pitch: number, volume: number): void {
    const ctx = this.ctx!;
    [0, 0.026].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime((i === 0 ? 1150 : 1550) * pitch, t + offset);
      osc.frequency.exponentialRampToValueAtTime(260, t + offset + 0.026);
      bp.type = 'bandpass';
      bp.frequency.value = 1200 * pitch;
      bp.Q.value = 1.6;
      g.gain.setValueAtTime(0.28 * volume, t + offset);
      g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.03);
      osc.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain!);
      osc.start(t + offset);
      osc.stop(t + offset + 0.034);
    });
  }

  private synthLidarPing(t: number, pitch: number, pan: number, volume: number): void {
    const ctx = this.ctx!;
    const carrier = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const env = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));

    const f0 = 1280 * pitch;
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(f0 * 1.03, t);
    carrier.frequency.exponentialRampToValueAtTime(f0, t + 0.045);
    carrier.frequency.exponentialRampToValueAtTime(f0 * 0.985, t + 1.35);

    mod.type = 'sine';
    mod.frequency.value = f0 * 2.41;
    modGain.gain.setValueAtTime(240, t);
    modGain.gain.exponentialRampToValueAtTime(4, t + 0.18);

    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.32 * volume, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.045 * volume, t + 0.28);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.45);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(env);
    env.connect(panner);
    panner.connect(this.masterGain!);

    mod.start(t);
    carrier.start(t);
    mod.stop(t + 1.5);
    carrier.stop(t + 1.5);
  }

  private synthProximityKlaxon(t: number, pitch: number, volume: number): void {
    const ctx = this.ctx!;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(880 * pitch, t);
    osc1.frequency.setValueAtTime(740 * pitch, t + 0.09);
    osc2.frequency.setValueAtTime(887 * pitch, t);
    osc2.frequency.setValueAtTime(746 * pitch, t + 0.09);

    lp.type = 'lowpass';
    lp.frequency.value = 2600;

    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22 * volume, t + 0.008);
    g.gain.setValueAtTime(0.22 * volume, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.21);

    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain!);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.22);
    osc2.stop(t + 0.22);
  }

  private synthLandingThud(t: number, pitch: number, volume: number): void {
    const ctx = this.ctx!;
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(125 * pitch, t);
    sub.frequency.exponentialRampToValueAtTime(34, t + 0.26);
    subGain.gain.setValueAtTime(0.55 * volume, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    sub.connect(subGain);
    subGain.connect(this.masterGain!);
    sub.start(t);
    sub.stop(t + 0.36);
  }

  private synthHullExplosion(t: number, volume: number): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const dur = 2.4;
    const len = Math.floor(sr * dur);
    const noiseBuf = ctx.createBuffer(1, len, sr);
    const d = noiseBuf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      brown = (brown + 0.05 * w) / 1.05;
      d[i] = Math.tanh(brown * 3.4 + w * 0.35);
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2800, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 2.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.75 * volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noiseSrc.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain!);
    noiseSrc.start(t);
  }
}
