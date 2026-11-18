import type { CrewManifestEntry } from '../types';

const STORAGE_KEY = 'nostromo_lander_crew_manifest_v1';
const MAX_ENTRIES = 10;

const DEFAULT_MANIFEST: CrewManifestEntry[] = [
  {
    callsign: 'RIPLEY',
    score: 28450,
    highestSector: 'SEC-05',
    accuracyRating: 'A',
    accuracyPercent: 91,
    mode: 'CAMPAIGN',
    date: '2122-06-03',
  },
  {
    callsign: 'DALLAS',
    score: 21900,
    highestSector: 'SEC-04',
    accuracyRating: 'A',
    accuracyPercent: 86,
    mode: 'CAMPAIGN',
    date: '2122-06-03',
  },
  {
    callsign: 'KANE',
    score: 14600,
    highestSector: 'SEC-03',
    accuracyRating: 'B',
    accuracyPercent: 78,
    mode: 'CAMPAIGN',
    date: '2122-06-03',
  },
  {
    callsign: 'PARKER',
    score: 9250,
    highestSector: 'SEC-02',
    accuracyRating: 'B',
    accuracyPercent: 74,
    mode: 'CAMPAIGN',
    date: '2122-06-02',
  },
  {
    callsign: 'LAMBERT',
    score: 5400,
    highestSector: 'SEC-01',
    accuracyRating: 'C',
    accuracyPercent: 68,
    mode: 'CAMPAIGN',
    date: '2122-06-02',
  },
];

export class CrewManifestStore {
  private entries: CrewManifestEntry[] = [];

  constructor() {
    this.entries = this.load();
  }

  private load(): CrewManifestEntry[] {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.save(DEFAULT_MANIFEST);
        return [...DEFAULT_MANIFEST];
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [...DEFAULT_MANIFEST];
      }
      const valid = parsed
        .filter(
          (item): item is CrewManifestEntry =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as CrewManifestEntry).callsign === 'string' &&
            typeof (item as CrewManifestEntry).score === 'number'
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_ENTRIES);
      return valid.length > 0 ? valid : [...DEFAULT_MANIFEST];
    } catch {
      return [...DEFAULT_MANIFEST];
    }
  }

  private save(list: CrewManifestEntry[]): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore storage quota / private browsing restrictions gracefully
    }
  }

  public getEntries(): readonly CrewManifestEntry[] {
    return this.entries;
  }

  public qualifiesForManifest(score: number): boolean {
    if (score <= 0) return false;
    if (this.entries.length < MAX_ENTRIES) return true;
    return score > this.entries[this.entries.length - 1].score;
  }

  public recordFlight(entry: Omit<CrewManifestEntry, 'date'> & { date?: string }): number {
    const sanitizedCallsign =
      entry.callsign
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
        .slice(0, 10) || 'PILOT-01';

    const now = new Date();
    const isoDate = entry.date ?? now.toISOString().slice(0, 10);

    const record: CrewManifestEntry = {
      callsign: sanitizedCallsign,
      score: Math.round(entry.score),
      highestSector: entry.highestSector,
      accuracyRating: entry.accuracyRating,
      accuracyPercent: Math.round(entry.accuracyPercent),
      mode: entry.mode,
      date: isoDate,
    };

    this.entries.push(record);
    this.entries.sort((a, b) => b.score - a.score);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.length = MAX_ENTRIES;
    }
    this.save(this.entries);

    return this.entries.indexOf(record);
  }
}
