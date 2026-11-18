import type { CrewManifestEntry, LeaderboardMode } from '../types';

const STORAGE_KEY = 'nostromo_lander_crew_manifest_v2';
const MAX_ENTRIES_PER_MODE = 15;

const ARCHIVE_CAMPAIGN: CrewManifestEntry[] = [
  {
    callsign: 'RIPLEY',
    score: 28450,
    sector: 5,
    highestSector: 'SEC-05',
    accuracyRating: 'A',
    accuracyPercent: 91,
    mode: 'CAMPAIGN',
    date: 'ARCHIVE',
    isArchiveFallback: true,
  },
  {
    callsign: 'DALLAS',
    score: 21900,
    sector: 4,
    highestSector: 'SEC-04',
    accuracyRating: 'A',
    accuracyPercent: 86,
    mode: 'CAMPAIGN',
    date: 'ARCHIVE',
    isArchiveFallback: true,
  },
  {
    callsign: 'KANE',
    score: 14600,
    sector: 3,
    highestSector: 'SEC-03',
    accuracyRating: 'B',
    accuracyPercent: 78,
    mode: 'CAMPAIGN',
    date: 'ARCHIVE',
    isArchiveFallback: true,
  },
  {
    callsign: 'PARKER',
    score: 9250,
    sector: 2,
    highestSector: 'SEC-02',
    accuracyRating: 'B',
    accuracyPercent: 74,
    mode: 'CAMPAIGN',
    date: 'ARCHIVE',
    isArchiveFallback: true,
  },
  {
    callsign: 'LAMBERT',
    score: 5400,
    sector: 1,
    highestSector: 'SEC-01',
    accuracyRating: 'C',
    accuracyPercent: 68,
    mode: 'CAMPAIGN',
    date: 'ARCHIVE',
    isArchiveFallback: true,
  },
];

const ARCHIVE_ENDLESS: CrewManifestEntry[] = [
  {
    callsign: 'ASH // 120-A2',
    score: 31200,
    sector: 6,
    highestSector: 'DS-06',
    accuracyRating: 'S+',
    accuracyPercent: 95,
    mode: 'ENDLESS',
    date: 'ARCHIVE',
    isArchiveFallback: true,
  },
  {
    callsign: 'RIPLEY',
    score: 22400,
    sector: 4,
    highestSector: 'DS-04',
    accuracyRating: 'A',
    accuracyPercent: 89,
    mode: 'ENDLESS',
    date: 'ARCHIVE',
    isArchiveFallback: true,
  },
  {
    callsign: 'BRETT',
    score: 11800,
    sector: 2,
    highestSector: 'DS-02',
    accuracyRating: 'B',
    accuracyPercent: 76,
    mode: 'ENDLESS',
    date: 'ARCHIVE',
    isArchiveFallback: true,
  },
];

export class CrewManifestStore {
  private localHumanEntries: CrewManifestEntry[] = [];

  constructor() {
    this.localHumanEntries = this.load();
  }

  private load(): CrewManifestEntry[] {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is CrewManifestEntry =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as CrewManifestEntry).callsign === 'string' &&
            typeof (item as CrewManifestEntry).score === 'number'
        )
        .map((e) => ({
          ...e,
          mode: (e.mode === 'ENDLESS' ? 'ENDLESS' : 'CAMPAIGN') as LeaderboardMode,
          sector: typeof e.sector === 'number' ? e.sector : 1,
          isArchiveFallback: true,
        }))
        .sort((a, b) => b.score - a.score);
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.localHumanEntries));
    } catch {
      // Ignore storage quota / private browsing restrictions gracefully
    }
  }

  public getEntriesByMode(mode: LeaderboardMode): readonly CrewManifestEntry[] {
    const matchingLocal = this.localHumanEntries
      .filter((e) => e.mode === mode)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ENTRIES_PER_MODE);

    if (matchingLocal.length > 0) {
      return matchingLocal;
    }

    return mode === 'ENDLESS' ? ARCHIVE_ENDLESS : ARCHIVE_CAMPAIGN;
  }

  public recordFlight(
    entry: Omit<CrewManifestEntry, 'date' | 'isArchiveFallback'> & { date?: string }
  ): number {
    // Allow any 1-16 char callsign friends enter (no profanity filter), trimmed & uppercase
    const sanitizedCallsign = entry.callsign.trim().slice(0, 16).toUpperCase() || 'PILOT-01';
    const now = new Date();
    const isoDate = entry.date ?? now.toISOString().slice(0, 10);

    const record: CrewManifestEntry = {
      callsign: sanitizedCallsign,
      score: Math.max(1, Math.min(1000000, Math.round(entry.score))),
      sector: Math.max(1, Math.min(99, Math.round(entry.sector))),
      highestSector: entry.highestSector,
      accuracyRating: entry.accuracyRating,
      accuracyPercent: Math.max(0, Math.min(100, Math.round(entry.accuracyPercent))),
      mode: entry.mode,
      date: isoDate,
      isArchiveFallback: true,
    };

    this.localHumanEntries.push(record);
    this.localHumanEntries.sort((a, b) => b.score - a.score);
    if (this.localHumanEntries.length > MAX_ENTRIES_PER_MODE * 2) {
      this.localHumanEntries.length = MAX_ENTRIES_PER_MODE * 2;
    }
    this.save();

    const modeList = this.getEntriesByMode(entry.mode);
    return Math.max(0, modeList.findIndex((r) => r === record));
  }
}
