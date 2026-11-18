import 'dotenv/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const AUDIO_OUT_DIR = path.join(ROOT_DIR, 'public', 'audio');
const MANIFEST_PATH = path.join(AUDIO_OUT_DIR, 'manifest.json');

const API_BASE = 'https://api.elevenlabs.io/v1';

interface SoundGenAsset {
  filename: string;
  prompt: string;
  loop: boolean;
  durationSeconds: number;
  promptInfluence: number;
}

interface VoiceCalloutAsset {
  filename: string;
  text: string;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
}

interface AudioManifest {
  version: number;
  generatedAt: string | null;
  voiceId: string | null;
  assets: Record<
    string,
    {
      path: string;
      category: 'loop' | 'sfx' | 'voice';
      bytes: number;
    }
  >;
}

const SOUND_ASSETS: SoundGenAsset[] = [
  // Seamless Loops (eleven_text_to_sound_v2 with loop: true)
  {
    filename: 'ambient_crt_buzz.mp3',
    prompt:
      'Deep 1979 spacecraft cabin air-handler drone with 60Hz CRT transformer hum and faint analog static.',
    loop: true,
    durationSeconds: 10,
    promptInfluence: 0.5,
  },
  {
    filename: 'thruster_main_loop.mp3',
    prompt:
      'Deep thunderous SpaceX Starship Raptor rocket landing burn, massive roaring liquid methane flame exhaust, chest-rattling low sub-bass rumble and crackling Mach plume, warm HD recording, no high-pitched whine.',
    loop: true,
    durationSeconds: 8,
    promptInfluence: 0.68,
  },
  {
    filename: 'thruster_rcs_loop.mp3',
    prompt: 'Pressurized cold-gas attitude thruster hiss.',
    loop: true,
    durationSeconds: 5,
    promptInfluence: 0.5,
  },
  {
    filename: 'lv426_wind_loop.mp3',
    prompt: 'Howling alien silicate dust storm buffeting a metal hull.',
    loop: true,
    durationSeconds: 10,
    promptInfluence: 0.5,
  },

  // Crisp HD One-Shot SFX (eleven_text_to_sound_v2)
  {
    filename: 'screen_power_on.mp3',
    prompt:
      'Heavy industrial 1970s relay switch thunk followed by rising CRT high-voltage flyback whine and static snap.',
    loop: false,
    durationSeconds: 2.8,
    promptInfluence: 0.5,
  },
  {
    filename: 'nostromo_boot_sequence.mp3',
    prompt:
      '1979 sci-fi spacecraft mainframe computer awakening sequence, vintage analog synthesizer data chirps, stuttering electronic telemetry bleeps, relay switches clattering, magnetic tape drive whir, eerie cassette futurism.',
    loop: false,
    durationSeconds: 5.5,
    promptInfluence: 0.65,
  },
  {
    filename: 'computer_telemetry_chirp.mp3',
    prompt:
      '1979 retro sci-fi computer terminal thinking noises, rapid muted analog synth telemetry bleeps and soft electronic data handshake chirps.',
    loop: false,
    durationSeconds: 2.2,
    promptInfluence: 0.65,
  },
  {
    filename: 'tape_drive_servo.mp3',
    prompt:
      '1970s mainframe magnetic tape reel servo spin-up whir, muted solenoid relay latch, and subtle analog computer hum.',
    loop: false,
    durationSeconds: 2.6,
    promptInfluence: 0.6,
  },
  {
    filename: 'ui_keyclick.mp3',
    prompt:
      'Single close-mic ASMR dull muted deep thocky mechanical keyboard keycap press, dampened thick plastic thud, soft warm low-end, no sharp click or metallic ring.',
    loop: false,
    durationSeconds: 0.8,
    promptInfluence: 0.72,
  },
  {
    filename: 'ui_keyclick_alt.mp3',
    prompt:
      'Single soft muted deep ASMR thick plastic keycap thock, dampened vintage terminal key bottom-out, warm dull thud, zero harsh treble.',
    loop: false,
    durationSeconds: 0.8,
    promptInfluence: 0.72,
  },
  {
    filename: 'thruster_ignite.mp3',
    prompt:
      'Deep powerful SpaceX rocket engine ignition whoosh and low-end combustion thump, heavy liquid propellant flame light-off.',
    loop: false,
    durationSeconds: 1.4,
    promptInfluence: 0.65,
  },
  {
    filename: 'button_latch_lock.mp3',
    prompt:
      'Heavy solid industrial steel cockpit latch engaging, chunky mechanical lock clunk and weighty damped metal bolt click.',
    loop: false,
    durationSeconds: 0.9,
    promptInfluence: 0.7,
  },
  {
    filename: 'keypress_return.mp3',
    prompt:
      'Heavy mechanical terminal carriage-return and metal cockpit toggle switch snap.',
    loop: false,
    durationSeconds: 1.0,
    promptInfluence: 0.5,
  },
  {
    filename: 'lidar_ping.mp3',
    prompt:
      'Resonant retro-futuristic sonar and LIDAR terrain sweep ping with metallic cavern decay.',
    loop: false,
    durationSeconds: 3.0,
    promptInfluence: 0.5,
  },
  {
    filename: 'proximity_klaxon.mp3',
    prompt: 'Tense 1979 Nostromo-style industrial electronic warning klaxon.',
    loop: false,
    durationSeconds: 1.5,
    promptInfluence: 0.5,
  },
  {
    filename: 'landing_soft_mech.mp3',
    prompt:
      'High-definition realistic spacecraft soft touchdown, heavy pneumatic hydraulic landing struts compressing smoothly, mechanical magnetic pad clamps locking shut, brief residual gas vent.',
    loop: false,
    durationSeconds: 2.5,
    promptInfluence: 0.68,
  },
  {
    filename: 'landing_hard_thud.mp3',
    prompt:
      'Crisp high-definition heavy spacecraft hard landing thud, violent solid metal landing gear slam onto pad, deep structural shock thump and hydraulic groan.',
    loop: false,
    durationSeconds: 2.2,
    promptInfluence: 0.7,
  },
  {
    filename: 'landing_strut_thud.mp3',
    prompt:
      'Heavy hydraulic shock compression and metallic landing pad lock clang.',
    loop: false,
    durationSeconds: 1.8,
    promptInfluence: 0.5,
  },
  {
    filename: 'hull_explosion.mp3',
    prompt:
      'High-definition realistic cinematic spacecraft explosion, violent pressurized hull rupture, thunderous fuel tank detonation shockwave, tearing metal debris, deep sub-bass boom.',
    loop: false,
    durationSeconds: 4.5,
    promptInfluence: 0.7,
  },
];

const VOICE_CALLOUTS: VoiceCalloutAsset[] = [
  {
    filename: 'voice_boot.mp3',
    text: 'Interface two-zero-three-seven ready. Orbital descent telemetry online.',
  },
  {
    filename: 'voice_wind.mp3',
    text: 'Caution. Severe atmospheric wind shear detected.',
  },
  {
    filename: 'voice_interference.mp3',
    text: 'Warning. Electromagnetic interference. Engage active radar.',
  },
  {
    filename: 'voice_fuel_low.mp3',
    text: 'Caution. Propellant reserves at twenty-five percent.',
  },
  {
    filename: 'voice_proximity.mp3',
    text: 'Descent rate.',
  },
  {
    filename: 'voice_pull_up.mp3',
    text: 'Pull up.',
  },
  {
    filename: 'voice_bank_angle.mp3',
    text: 'Bank angle.',
  },
  {
    filename: 'voice_touchdown.mp3',
    text: 'Contact light. Engine stop. Touchdown confirmed.',
  },
  {
    filename: 'voice_hull_breach.mp3',
    text: 'Critical hull breach. Descent signal lost.',
  },
];

async function fileSizeBytes(filepath: string): Promise<number> {
  try {
    const stat = await fs.stat(filepath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

async function resolveClinicalFemaleVoiceId(apiKey: string): Promise<string> {
  const envOverride = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (envOverride) {
    console.log(`[MU-TH-UR] Using ELEVENLABS_VOICE_ID override: ${envOverride}`);
    return envOverride;
  }

  const fallbackRachelId = '21m00Tcm4TlvDq8ikWAM';
  try {
    const res = await fetch(`${API_BASE}/voices`, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      console.warn(`[MU-TH-UR] GET /v1/voices returned ${res.status}; falling back to default voice.`);
      return fallbackRachelId;
    }

    const data = (await res.json()) as { voices?: ElevenLabsVoice[] };
    const voices = data.voices ?? [];
    if (voices.length === 0) return fallbackRachelId;

    let bestVoice = voices[0];
    let bestScore = -999;

    for (const v of voices) {
      const labels = v.labels ?? {};
      const gender = (labels.gender ?? '').toLowerCase();
      const accent = (labels.accent ?? '').toLowerCase();
      const desc = `${labels.description ?? ''} ${labels.use_case ?? ''} ${v.name}`.toLowerCase();

      let score = 0;
      if (gender === 'female') score += 50;
      else if (gender === 'male') score -= 50;

      if (accent.includes('british') || accent.includes('english') || accent.includes('uk')) score += 20;
      else if (accent.includes('american') || accent.includes('neutral')) score += 10;

      if (desc.includes('calm')) score += 18;
      if (desc.includes('clinical') || desc.includes('clear') || desc.includes('narration')) score += 12;
      if (desc.includes('soft') || desc.includes('composed') || desc.includes('news')) score += 8;

      if (score > bestScore) {
        bestScore = score;
        bestVoice = v;
      }
    }

    console.log(`[MU-TH-UR] Selected voice "${bestVoice.name}" (${bestVoice.voice_id})`);
    return bestVoice.voice_id;
  } catch (err) {
    console.warn(`[MU-TH-UR] Failed to query /v1/voices (${String(err)}); using fallback ID.`);
    return fallbackRachelId;
  }
}

async function generateSoundEffect(apiKey: string, asset: SoundGenAsset, destPath: string): Promise<void> {
  const fullPayload: Record<string, unknown> = {
    text: asset.prompt,
    model_id: 'eleven_text_to_sound_v2',
    duration_seconds: asset.durationSeconds,
    prompt_influence: asset.promptInfluence,
  };
  if (asset.loop) {
    fullPayload.loop = true;
  }

  let res = await fetch(`${API_BASE}/sound-generation?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(fullPayload),
  });

  // Automatic retry with minimal standard payload if optional params return HTTP 400/422
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    console.warn(
      `  [WARN] Optional parameters returned ${res.status} for ${asset.filename}; retrying standard payload...`
    );
    res = await fetch(`${API_BASE}/sound-generation`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: asset.prompt,
        duration_seconds: asset.durationSeconds,
        prompt_influence: 0.5,
      }),
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Sound Generation failed (${res.status}): ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(arrayBuffer));
}

async function generateVoiceCallout(
  apiKey: string,
  voiceId: string,
  asset: VoiceCalloutAsset,
  destPath: string
): Promise<void> {
  const sendTts = async (modelId: string): Promise<Response> => {
    const url = `${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: asset.text,
        model_id: modelId,
        voice_settings: {
          stability: 0.86,
          similarity_boost: 0.78,
          style: 0.05,
          use_speaker_boost: true,
        },
      }),
    });
  };

  let res = await sendTts('eleven_multilingual_v2');
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    res = await sendTts('eleven_monolingual_v1');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TTS Generation failed (${res.status}): ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(arrayBuffer));
}

async function writeManifestFromDisk(voiceId: string | null): Promise<AudioManifest> {
  const assets: AudioManifest['assets'] = {};

  for (const s of SOUND_ASSETS) {
    const fullPath = path.join(AUDIO_OUT_DIR, s.filename);
    const bytes = await fileSizeBytes(fullPath);
    if (bytes > 512) {
      const id = s.filename.replace(/\.mp3$/i, '');
      assets[id] = {
        path: `/audio/${s.filename}`,
        category: s.loop ? 'loop' : 'sfx',
        bytes,
      };
    }
  }

  for (const v of VOICE_CALLOUTS) {
    const fullPath = path.join(AUDIO_OUT_DIR, v.filename);
    const bytes = await fileSizeBytes(fullPath);
    if (bytes > 512) {
      const id = v.filename.replace(/\.mp3$/i, '');
      assets[id] = {
        path: `/audio/${v.filename}`,
        category: 'voice',
        bytes,
      };
    }
  }

  const manifest: AudioManifest = {
    version: 2,
    generatedAt: Object.keys(assets).length > 0 ? new Date().toISOString() : null,
    voiceId,
    assets,
  };

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  await fs.mkdir(AUDIO_OUT_DIR, { recursive: true });

  console.log('====================================================================');
  console.log(' INTERFACE 2037 // ELEVENLABS HD AUDIO ASSET PIPELINE');
  console.log('====================================================================');

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey || apiKey === 'your_api_key_here') {
    const manifest = await writeManifestFromDisk(null);
    console.error('\n[ERROR] Missing valid ELEVENLABS_API_KEY in .env.');
    console.log(
      `[INFO] Synced public/audio/manifest.json (${Object.keys(manifest.assets).length} existing asset(s)).`
    );
    process.exitCode = 1;
    return;
  }

  let generatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // 1. Sound Generation Assets (4 Seamless Loops + 7 HD One-Shot SFX)
  for (const asset of SOUND_ASSETS) {
    const destPath = path.join(AUDIO_OUT_DIR, asset.filename);
    const existingBytes = await fileSizeBytes(destPath);
    if (existingBytes > 5120 && !force) {
      console.log(`[SKIP] ${asset.filename} (${(existingBytes / 1024).toFixed(1)} KB). Pass --force to regenerate.`);
      skippedCount++;
      continue;
    }

    process.stdout.write(`[GEN]  ${asset.filename} (v2${asset.loop ? ', loop' : ''})... `);
    try {
      await generateSoundEffect(apiKey, asset, destPath);
      const bytes = await fileSizeBytes(destPath);
      console.log(`OK (${(bytes / 1024).toFixed(1)} KB)`);
      generatedCount++;
    } catch (err) {
      console.log('FAILED');
      console.error(`       ${String(err)}`);
      failedCount++;
    }
  }

  // 2. MU-TH-UR 6000 TTS Callouts (7 Voice Files)
  const voiceId = await resolveClinicalFemaleVoiceId(apiKey);
  for (const asset of VOICE_CALLOUTS) {
    const destPath = path.join(AUDIO_OUT_DIR, asset.filename);
    const existingBytes = await fileSizeBytes(destPath);
    if (existingBytes > 5120 && !force) {
      console.log(`[SKIP] ${asset.filename} (${(existingBytes / 1024).toFixed(1)} KB). Pass --force to regenerate.`);
      skippedCount++;
      continue;
    }

    process.stdout.write(`[TTS]  ${asset.filename} -> "${asset.text}"... `);
    try {
      await generateVoiceCallout(apiKey, voiceId, asset, destPath);
      const bytes = await fileSizeBytes(destPath);
      console.log(`OK (${(bytes / 1024).toFixed(1)} KB)`);
      generatedCount++;
    } catch (err) {
      console.log('FAILED');
      console.error(`       ${String(err)}`);
      failedCount++;
    }
  }

  const manifest = await writeManifestFromDisk(voiceId);
  const totalExpected = SOUND_ASSETS.length + VOICE_CALLOUTS.length;
  console.log('\n====================================================================');
  console.log(` COMPLETE: ${generatedCount} generated, ${skippedCount} skipped, ${failedCount} failed.`);
  console.log(` MANIFEST: ${Object.keys(manifest.assets).length}/${totalExpected} assets registered in public/audio/manifest.json`);
  console.log('====================================================================');

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exitCode = 1;
});
