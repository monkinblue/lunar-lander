import { initializeApp } from 'firebase/app';
import {
  addDoc,
  collection,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Firestore,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { CrewManifestStore } from '../storage/CrewManifest';
import type { CrewManifestEntry, LeaderboardMode } from '../types';

const firebaseConfig = {
  apiKey: 'AIzaSyCpq9BNHG1cplrbkrHdT_WttUxcy-E5rYk',
  authDomain: 'emma-lunar-lander.firebaseapp.com',
  projectId: 'emma-lunar-lander',
  storageBucket: 'emma-lunar-lander.firebasestorage.app',
  messagingSenderId: '413423291271',
  appId: '1:413423291271:web:88ad18690129349a07e122',
};

const CALLSIGN_STORAGE_KEY = 'nostromo_lander_last_callsign_v1';

export type UplinkConnectionStatus = 'LOADING' | 'LIVE' | 'OFFLINE';

interface FirestoreScoreDoc {
  callsign?: unknown;
  score?: unknown;
  sector?: unknown;
  mode?: unknown;
  accuracy?: unknown;
  createdAt?: Timestamp | null;
}

export function accuracyToGrade(pct: number): string {
  if (pct >= 93) return 'S+';
  if (pct >= 84) return 'A';
  if (pct >= 72) return 'B';
  return 'C';
}

export function formatSectorCode(sectorNum: number, mode: LeaderboardMode): string {
  const clamped = Math.max(1, Math.min(99, Math.round(sectorNum)));
  const padded = String(clamped).padStart(2, '0');
  return mode === 'ENDLESS' ? `DS-${padded}` : `SEC-${padded}`;
}

export class GlobalLeaderboardService {
  private db: Firestore | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private localFallback = new CrewManifestStore();

  private status: UplinkConnectionStatus = 'LOADING';
  private campaignOnline: CrewManifestEntry[] = [];
  private endlessOnline: CrewManifestEntry[] = [];

  constructor() {
    this.initRealtimeSubscription();
  }

  private initRealtimeSubscription(): void {
    try {
      const app = initializeApp(firebaseConfig);
      this.db = getFirestore(app);

      // Single-field index query ONLY (no where() clause to avoid composite index errors!)
      const scoresQuery = query(
        collection(this.db, 'scores'),
        orderBy('score', 'desc'),
        limit(100)
      );

      this.unsubscribe = onSnapshot(
        scoresQuery,
        (snapshot) => {
          const campaign: CrewManifestEntry[] = [];
          const endless: CrewManifestEntry[] = [];

          snapshot.forEach((docSnap) => {
            const raw = docSnap.data() as FirestoreScoreDoc;
            if (typeof raw.callsign !== 'string' || typeof raw.score !== 'number') {
              return;
            }
            const mode: LeaderboardMode = raw.mode === 'ENDLESS' ? 'ENDLESS' : 'CAMPAIGN';
            const sector =
              typeof raw.sector === 'number' && Number.isFinite(raw.sector)
                ? Math.max(1, Math.min(99, Math.round(raw.sector)))
                : 1;
            const accuracy =
              typeof raw.accuracy === 'number' && Number.isFinite(raw.accuracy)
                ? Math.max(0, Math.min(100, Math.round(raw.accuracy)))
                : 75;

            let dateStr = 'LIVE';
            if (raw.createdAt && typeof raw.createdAt.toDate === 'function') {
              try {
                dateStr = raw.createdAt.toDate().toISOString().slice(0, 10);
              } catch {
                dateStr = 'LIVE';
              }
            }

            const entry: CrewManifestEntry = {
              id: docSnap.id,
              callsign: raw.callsign.trim().slice(0, 16).toUpperCase() || 'PILOT',
              score: Math.round(raw.score),
              sector,
              highestSector: formatSectorCode(sector, mode),
              accuracyRating: accuracyToGrade(accuracy),
              accuracyPercent: accuracy,
              mode,
              date: dateStr,
              isArchiveFallback: false,
            };

            if (mode === 'ENDLESS') {
              if (endless.length < 15) endless.push(entry);
            } else {
              if (campaign.length < 15) campaign.push(entry);
            }
          });

          campaign.sort((a, b) => b.score - a.score);
          endless.sort((a, b) => b.score - a.score);

          this.campaignOnline = campaign;
          this.endlessOnline = endless;
          this.status = 'LIVE';
        },
        (err) => {
          console.warn('[MU-TH-UR UPLINK] Firestore live stream unavailable, using local archive:', err);
          this.status = 'OFFLINE';
        }
      );
    } catch (err) {
      console.warn('[MU-TH-UR UPLINK] Firebase init error, using local archive:', err);
      this.status = 'OFFLINE';
    }
  }

  public dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  public getStatus(): UplinkConnectionStatus {
    return this.status;
  }

  public getSavedCallsign(): string {
    try {
      const saved = window.localStorage.getItem(CALLSIGN_STORAGE_KEY);
      if (saved && saved.trim().length > 0) {
        return saved.trim().slice(0, 16).toUpperCase();
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  public saveCallsign(callsign: string): string {
    const cleaned = callsign.trim().slice(0, 16).toUpperCase() || 'PILOT-01';
    try {
      window.localStorage.setItem(CALLSIGN_STORAGE_KEY, cleaned);
    } catch {
      /* ignore */
    }
    return cleaned;
  }

  /**
   * Reigning #01 Global Human Champion for Main Menu Banner (never returns NPC archive entries).
   */
  public getReigningChampion(mode: LeaderboardMode): CrewManifestEntry | null {
    const list = mode === 'ENDLESS' ? this.endlessOnline : this.campaignOnline;
    return list.length > 0 ? list[0] : null;
  }

  /**
   * Returns Top 15 entries for the selected mode.
   * Prioritizes real Firestore human scores exclusively when present; falls back to
   * clearly flagged [LOCAL / ARCHIVE] entries only if offline or 0 human entries exist.
   */
  public getManifestEntries(mode: LeaderboardMode): {
    entries: readonly CrewManifestEntry[];
    showingArchiveFallback: boolean;
  } {
    const onlineList = mode === 'ENDLESS' ? this.endlessOnline : this.campaignOnline;
    if (onlineList.length > 0) {
      return { entries: onlineList, showingArchiveFallback: false };
    }

    const fallback = this.localFallback.getEntriesByMode(mode);
    return { entries: fallback, showingArchiveFallback: true };
  }

  /**
   * Submits a finalized run score to Firestore `scores` with the exact 6-field schema
   * required by published Security Rules (and mirrors locally as offline backup).
   */
  public async submitScore(params: {
    callsign: string;
    score: number;
    sector: number;
    mode: LeaderboardMode;
    accuracy: number;
  }): Promise<{ ok: boolean; rank: number; mode: LeaderboardMode; offlineFallback: boolean }> {
    const callsign = this.saveCallsign(params.callsign);
    const score = Math.max(1, Math.min(1000000, Math.round(params.score)));
    const sector = Math.max(1, Math.min(99, Math.round(params.sector)));
    const mode: LeaderboardMode = params.mode === 'ENDLESS' ? 'ENDLESS' : 'CAMPAIGN';
    const accuracy = Math.max(0, Math.min(100, Math.round(params.accuracy)));

    // Always mirror to local storage backup
    this.localFallback.recordFlight({
      callsign,
      score,
      sector,
      highestSector: formatSectorCode(sector, mode),
      accuracyRating: accuracyToGrade(accuracy),
      accuracyPercent: accuracy,
      mode,
    });

    if (!this.db) {
      const localList = this.localFallback.getEntriesByMode(mode);
      const localRank = Math.max(1, localList.findIndex((e) => e.score <= score) + 1);
      return { ok: false, rank: localRank, mode, offlineFallback: true };
    }

    try {
      // EXACT 6-key document matching published Firestore Security Rules (ZERO extra keys!)
      await addDoc(collection(this.db, 'scores'), {
        callsign,
        score,
        sector,
        mode,
        accuracy,
        createdAt: serverTimestamp(),
      });

      const onlineList = mode === 'ENDLESS' ? this.endlessOnline : this.campaignOnline;
      let higherCount = 0;
      for (const item of onlineList) {
        if (item.score > score) higherCount++;
      }
      const rank = higherCount + 1;
      return { ok: true, rank, mode, offlineFallback: false };
    } catch (err) {
      console.error('[MU-TH-UR UPLINK] Score transmission rejected or failed:', err);
      const localList = this.localFallback.getEntriesByMode(mode);
      const localRank = Math.max(1, localList.findIndex((e) => e.score <= score) + 1);
      return { ok: false, rank: localRank, mode, offlineFallback: true };
    }
  }
}
