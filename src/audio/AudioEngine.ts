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

  // Continuous DSP loop nodes
  private mainThrusterSource: AudioBufferSourceNode | null = null;
  private mainThrusterFilter: BiquadFilterNode | null = null;
  private mainThrusterGain: GainNode | null = null;

  private rcsThrusterSource: AudioBufferSourceNode | null = null;
  private rcsPanner: StereoPannerNode | null = null;
  private rcsFilter: BiquadFilterNode | null = null;
  private rcsGain: GainNode | null = null;

  private cabinHumSource: AudioBufferSourceNode | null = null;
  private cabinHumGain: GainNode | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private buffers = new Map<string, AudioBuffer>();
  private bufferOnsets = new Map<string, number>();
  private rawPrefetched = new Map<string, { data: ArrayBuffer; category: 'loop' | 'sfx' | 'voice' }>();
  private prefetchPromise: Promise<void> | null = null;
  private decodePromise: Promise<void> | null = null;

  private muted = false;
  private unlocked = false;
  private activeVoiceSource: AudioBufferSourceNode | null = null;
  private lastVoiceTime = 0;
  private lastKlaxonTime = 0;
  private lastKeyclickTime = 0;
  private keyAltToggle = false;

  constructor() {
    this.prefetchPromise = this.prefetchManifestAndMp3s();
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

      const entries = Object.entries(data.assets);
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

  private async decodePrefetchedBuffers(): Promise<void> {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const pending = Array.from(this.rawPrefetched.entries()).filter(
      ([id]) => !this.buffers.has(id)
    );
    if (pending.length === 0) return;

    await Promise.all(
      pending.map(async ([id, item]) => {
        try {
          const copy = item.data.slice(0);
          const decoded = await ctx.decodeAudioData(copy);
          this.buffers.set(id, decoded);
          if (item.category === 'sfx') {
            this.bufferOnsets.set(id, this.detectTransientOnsetSec(decoded));
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

    if (!this.decodePromise) {
      this.decodePromise = (async () => {
        if (this.prefetchPromise) {
          await this.prefetchPromise;
        }
        await this.decodePrefetchedBuffers();
      })();
    }
    await this.decodePromise;
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
      this.crossfadeLoopSeamless(data, Math.floor(sr * 0.15));
      this.buffers.set('thruster_main_loop', buf);
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
      this.crossfadeLoopSeamless(data, Math.floor(sr * 0.08));
      this.buffers.set('thruster_rcs_loop', buf);
    }

    if (!this.buffers.has('ambient_crt_buzz')) {
      const len = sr * 4;
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const white = Math.random() * 2 - 1;
        lp = lp + 0.018 * (white - lp);
        const hum60 = Math.sin(2 * Math.PI * 60 * t) * 0.06;
        const hum120 = Math.sin(2 * Math.PI * 120 * t) * 0.032;
        const sub42 = Math.sin(2 * Math.PI * 42 * t) * 0.09;
        data[i] = lp * 0.9 + hum60 + hum120 + sub42;
      }
      this.crossfadeLoopSeamless(data, Math.floor(sr * 0.12));
      this.buffers.set('ambient_crt_buzz', buf);
    }

    if (!this.buffers.has('lv426_wind_loop')) {
      const len = sr * 5;
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const white = Math.random() * 2 - 1;
        const f = 320 + 140 * Math.sin((2 * Math.PI * t) / 5) + 75 * Math.cos((4 * Math.PI * t) / 5);
        const c = 2 * Math.sin((Math.PI * f) / sr);
        const q = 0.09;
        y1 += c * y2;
        const hp = white - y1 - q * y2;
        y2 += c * hp;
        data[i] = Math.tanh(y2 * 0.28 + white * 0.04);
      }
      this.crossfadeLoopSeamless(data, Math.floor(sr * 0.2));
      this.buffers.set('lv426_wind_loop', buf);
    }
  }

  private crossfadeLoopSeamless(data: Float32Array, fadeSamples: number): void {
    const n = data.length;
    if (fadeSamples * 2 >= n) return;
    for (let i = 0; i < fadeSamples; i++) {
      const alpha = i / fadeSamples;
      const head = data[i];
      const tail = data[n - fadeSamples + i];
      data[i] = tail * (1 - alpha) + head * alpha;
      data[n - fadeSamples + i] = data[n - fadeSamples + i] * (1 - alpha) + data[0] * alpha;
    }
  }

  private startContinuousLoops(): void {
    const ctx = this.ctx!;
    if (!this.masterGain) return;

    this.mainThrusterFilter = ctx.createBiquadFilter();
    this.mainThrusterFilter.type = 'lowpass';
    this.mainThrusterFilter.frequency.value = 180;
    this.mainThrusterFilter.Q.value = 1.15;

    this.mainThrusterGain = ctx.createGain();
    this.mainThrusterGain.gain.value = 0;

    this.mainThrusterFilter.connect(this.mainThrusterGain);
    this.mainThrusterGain.connect(this.masterGain);
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

    // Deep omnipresent 1979 Nostromo "Mother" room sub-drone & CRT buzz
    this.cabinHumGain = ctx.createGain();
    this.cabinHumGain.gain.value = 0.34;
    this.cabinHumGain.connect(this.masterGain);
    this.restartLoopSource('ambient_crt_buzz');

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 950;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    this.restartLoopSource('lv426_wind_loop');
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
      this.mainThrusterSource.playbackRate.value = 0.85;
      this.mainThrusterSource.connect(this.mainThrusterFilter);
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
    } else if ((id === 'ambient_crt_buzz' || id === 'nostromo_cabin_hum') && this.cabinHumGain) {
      try {
        this.cabinHumSource?.stop();
      } catch {
        /* ignore */
      }
      this.cabinHumSource = makeSource();
      this.cabinHumSource.connect(this.cabinHumGain);
      this.cabinHumSource.start();
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

  public updateFlightDsp(
    throttle: number,
    rcsDirection: number,
    rcsIntensity: number,
    windSpeedMps: number,
    flightActive: boolean
  ): void {
    if (!this.ctx || !this.unlocked) return;
    const now = this.ctx.currentTime;

    if (!flightActive) {
      this.mainThrusterGain?.gain.setTargetAtTime(0, now, 0.06);
      this.rcsGain?.gain.setTargetAtTime(0, now, 0.04);
      this.windGain?.gain.setTargetAtTime(0, now, 0.12);
      return;
    }

    const clampedNorm = Math.max(0, Math.min(1, throttle));
    const overdriveExtra = Math.max(0, throttle - 1);
    const targetRate = 0.85 + clampedNorm * 0.4 + overdriveExtra * 0.32;
    const targetCutoff = 180 + Math.pow(clampedNorm, 1.15) * 3020 + overdriveExtra * 900;
    const targetMainGain = throttle > 0.005 ? Math.min(0.84, 0.16 + throttle * 0.52) : 0;

    this.mainThrusterSource?.playbackRate.setTargetAtTime(targetRate, now, 0.04);
    this.mainThrusterFilter?.frequency.setTargetAtTime(targetCutoff, now, 0.04);
    this.mainThrusterGain?.gain.setTargetAtTime(targetMainGain, now, 0.035);

    const targetPan = Math.max(-0.6, Math.min(0.6, rcsDirection * 0.52));
    const targetRcsGain = rcsIntensity > 0.01 ? Math.min(0.4, rcsIntensity * 0.32) : 0;
    this.rcsPanner?.pan.setTargetAtTime(targetPan, now, 0.03);
    this.rcsGain?.gain.setTargetAtTime(targetRcsGain, now, 0.025);

    const windNorm = Math.min(1, windSpeedMps / 14);
    const targetWindGain = windNorm * 0.38;
    const targetWindFreq = 450 + windNorm * 1800;
    this.windGain?.gain.setTargetAtTime(targetWindGain, now, 0.12);
    this.windFilter?.frequency.setTargetAtTime(targetWindFreq, now, 0.12);
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
   * Plays the full 1979 ALIEN ("Mother" Bridge Awakening Scene - Mn7A1vfs8m0)
   * initialization audio choreography: heavy relay switch, CRT HV flyback,
   * ElevenLabs mainframe chirp/relay sequence, tape-drive spin-up, and rhythmic
   * 1979 FSK analog mainframe bleep cascade.
   */
  public playAlienBootAwakening(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    this.playSfx('screen_power_on', { volume: 0.92 });
    this.playSfx('nostromo_boot_sequence', { volume: 0.85, pitch: 0.96 });
    this.playSfx('tape_drive_servo', { volume: 0.68, pitch: 0.94 });

    // Authentic 1979 Jim Shields-style rhythmic FSK analog mainframe awakening bleeps
    this.synth1979MainframeCascade(now + 0.18);
  }

  /**
   * Plays subtle 1979 Nostromo computer thinking / data-bus telemetry chirps
   * during terminal transitions, diagnostic lines, and ambient cockpit background.
   */
  public playAlienComputerActivity(intensity = 0.55): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (Math.random() < 0.65 && this.buffers.has('computer_telemetry_chirp')) {
      this.playSfx('computer_telemetry_chirp', {
        volume: intensity,
        pitch: 0.88 + Math.random() * 0.22,
        pan: (Math.random() - 0.5) * 0.4,
      });
    } else if (this.buffers.has('tape_drive_servo')) {
      this.playSfx('tape_drive_servo', {
        volume: intensity * 0.72,
        pitch: 0.92 + Math.random() * 0.16,
        pan: (Math.random() - 0.5) * 0.35,
      });
    } else {
      this.synth1979MainframeCascade(this.ctx.currentTime, 4, intensity * 0.5);
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
        lookupKey === 'keypress_return' || lookupKey === 'screen_power_on'
          ? onset
          : 0;
      src.start(now, startOffset);
      return;
    }

    switch (id) {
      case 'screen_power_on':
        this.synthScreenPowerOn(now, volume);
        break;
      case 'nostromo_boot_sequence':
      case 'computer_telemetry_chirp':
      case 'tape_drive_servo':
        this.synth1979MainframeCascade(now, 8, volume * 0.5);
        break;
      case 'keypress_return':
      case 'ui_toggle_switch':
        this.synthToggleSwitch(now, pitch, volume);
        break;
      case 'lidar_ping':
        this.synthLidarPing(now, pitch, pan, volume);
        break;
      case 'proximity_klaxon':
        this.synthProximityKlaxon(now, pitch, volume);
        break;
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
  private synth1979MainframeCascade(t: number, steps = 14, gainScale = 0.42): void {
    const ctx = this.ctx!;
    const dest = this.intercomInput ?? this.masterGain!;
    // Classic 1979 cassette-futurism pentatonic/quartal telemetry register frequencies
    const registers = [440, 587.3, 659.2, 784.0, 987.8, 523.2, 880, 392.0];

    let cursor = t;
    for (let i = 0; i < steps; i++) {
      const dur = i % 4 === 3 ? 0.085 : 0.042;
      const gap = i % 5 === 4 ? 0.11 : 0.052;
      const freq = registers[(i * 3 + Math.floor(i / 2)) % registers.length];

      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();

      osc.type = i % 3 === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, cursor);

      lp.type = 'lowpass';
      lp.frequency.value = 1650;

      g.gain.setValueAtTime(0.0001, cursor);
      g.gain.linearRampToValueAtTime(0.11 * gainScale, cursor + 0.006);
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
    const freqs = [784, 1046.5];
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
