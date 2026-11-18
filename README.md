# INTERFACE 2037 // USCSS NOSTROMO ORBITAL DESCENT TELEMETRY

A desktop-first, retro-futuristic vector **Lunar Lander** simulation inspired by Ron Cobb's USCSS *Nostromo* / *Narcissus* descent monitors and the **MU-TH-UR 6000** cassette-futurism aesthetic from *ALIEN* (1979). Architected as a static zero-backend Vite + TypeScript web application ready for deployment on **emma-dawson.com**.

---

## Architecture Highlights

- **Dual-Stage High-DPI Rendering Pipeline**:
  1. **Offscreen 2D Vector CAD Canvas**: Renders razor-sharp high-DPI skeletal shuttle geometry with articulating spring-damper landing struts, gimbaled main rocket plumes, cold-gas RCS attitude puffs, multi-layered seismic rock strata, enclosed cavern ceilings, blinking pad beacons, flight-space prograde/retrograde markers, and Nostromo corner-bracket HUD vernier gauges scaled to `window.devicePixelRatio`.
  2. **Full-Screen WebGL Curved CRT Post-Processor**: Warps the 2D telemetry feed onto curved P39 phosphor monitor glass with corner specular highlights, multi-tap phosphor halation/bloom, ultra-fine high-DPI aperture grille scanlines, 60Hz phosphor persistence, and dynamic analog signal tear, snow, and chromatic fringe driven by EM ion storms, hard landings, and thruster overdrive.
- **Tactile Hardware Bezel UI**: Mouse-interactive mechanical toggle switches and rotary potentiometer dial mounted outside the curved CRT glass (`SAS ATTITUDE DAMPENER`, `AUTO-ZOOM APPROACH`, `CRT GLASS & BLOOM INTENSITY`, `INTERCOM / AUDIO BUS MUTE`, and `MU-TH-UR FLIGHT LOGS`).
- **Fixed-Timestep 60Hz Rigid-Body Physics**: Propellant mass-depletion dynamically increases thrust-to-weight ratio (TWR) and rotational responsiveness as tanks empty; includes main engine spool inertia, emergency overdrive burn, altitude-layered wind shear, vertical thermal updraft vents, intermediate refueling depots, raycast nose spotlight, and 4-second decaying active LIDAR sweeps.
- **Hybrid ElevenLabs + Web Audio DSP Engine**: Offline CLI asset pipeline (`npm run generate:audio`) for ElevenLabs Sound Generation & MU-TH-UR 6000 TTS callouts, paired with real-time Web Audio filter/pitch modulation, stereo RCS panning, a 350Hz–3400Hz soft-clipped shipboard intercom chain, and a 100% zero-crash procedural Web Audio synthesizer fallback when MP3s are absent.

---

## Flight Deck Controls

### Keyboard Controls
| Key | System Function |
| :--- | :--- |
| `W` or `Up Arrow` | **Main Descent Engine Throttle** (smooth turbopump spool-up/down inertia) |
| `Shift` + `W` / `Up` | **Emergency Max Overdrive Burn** (`135%` thrust at higher propellant burn rate) |
| `A` / `D` or `Left` / `Right` | **RCS Cold-Gas Attitude Thrusters** (rotate counter-clockwise / clockwise) |
| `S` or `Down Arrow` | **Retro-Stabilizer Assist** (damps spin, uprights attitude, and arrests lateral drift) |
| `Spacebar` | **Omnidirectional LIDAR Sweep** (360° terrain radar pulse; illuminates rock for 4s) |
| `R` | **Instant Sector Quick-Retry** |
| `Esc` | **MU-TH-UR 6000 Command Interrupt / Pause Overlay** |

### Mouse Controls
| Action | System Function |
| :--- | :--- |
| **Mouse Move (in CRT)** | Steers directional **Shuttle Nose Spotlight & Narrow-Beam Rangefinder** |
| **Left-Click (in CRT)** | Fires a **Focused Directional LIDAR Ping** toward cursor (longer range, lower capacitor cost) |
| **Mouse Scroll Wheel** | Manual tactical camera zoom (`1.0x` Sector Macro Overview to `3.5x` Precision Approach) |
| **Click / Drag Bezel** | Operates physical cockpit toggle switches and the **CRT Glass & Bloom** rotary dial |

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start Vite development server
npm run dev

# 3. Typecheck client + CLI scripts and build production bundle into dist/
npm run build

# 4. Preview production build locally
npm run preview
```

---

## ElevenLabs Audio Generation Pipeline (Optional)

The game runs **out-of-the-box with zero console errors** using its built-in procedural Web Audio DSP synthesizer. To generate and bundle high-fidelity ElevenLabs rocket loops, mechanical cockpit SFX, and clinical **MU-TH-UR 6000** voice callouts:

1. Copy `.env.example` to `.env` (`.env` is gitignored so your API key never leaks to the repository or Vite client bundle):
   ```bash
   cp .env.example .env
   ```
2. Add your ElevenLabs API key to `.env`:
   ```ini
   ELEVENLABS_API_KEY=sk_your_actual_elevenlabs_api_key
   # Optional: specify a custom clinical female voice ID (auto-selected via /v1/voices if omitted)
   # ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
   ```
3. Run the audio asset generator CLI:
   ```bash
   npm run generate:audio
   ```
   - Existing `.mp3` files in `public/audio/` are automatically skipped to conserve ElevenLabs API credits.
   - Pass `--force` (`npm run generate:audio -- --force`) to regenerate all 17 audio assets and rewrite `public/audio/manifest.json`.

---

## Static Deployment to `emma-dawson.com` (GitHub Pages)

This repository includes [`public/CNAME`](./public/CNAME) (`emma-dawson.com`) and an automated GitHub Actions workflow in [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) that builds `./dist` on every push to `main` and deploys via `actions/deploy-pages@v4`.

### Deployment Steps
1. Push changes to `main` (generated `public/audio/*.mp3` and `public/audio/manifest.json` are committed directly so CI never needs your `ELEVENLABS_API_KEY`; `.env` remains excluded via `.gitignore`).
2. In GitHub **Settings -> Pages**, set **Build and deployment -> Source** to **GitHub Actions**.
3. Configure DNS `A` / `CNAME` records for `emma-dawson.com` pointing to GitHub Pages.
