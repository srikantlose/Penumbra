export interface CalibrationData {
  formulaVersion: string;
  corpusSize: number;
  minScore: number;
  maxScore: number;
  mean: number;
  stdDev: number;
  percentiles: Record<number, number>;
}

export interface PercentileEntry {
  score: number;
  percentile: number;
}

export class FogCalibration {
  private data: CalibrationData;
  private percentileLookup: PercentileEntry[] = [];

  constructor(data: CalibrationData) {
    this.data = data;
    this.buildPercentileLookup();
  }

  private buildPercentileLookup(): void {
    const entries: PercentileEntry[] = [];
    for (const [percStr, score] of Object.entries(this.data.percentiles)) {
      const percentile = parseFloat(percStr);
      entries.push({ score, percentile });
    }
    this.percentileLookup = entries.sort((a, b) => a.score - b.score);
  }

  getPercentile(score: number): number | null {
    if (this.percentileLookup.length === 0) return null;

    if (score <= this.percentileLookup[0].score) {
      return this.percentileLookup[0].percentile;
    }

    if (score >= this.percentileLookup[this.percentileLookup.length - 1].score) {
      return this.percentileLookup[this.percentileLookup.length - 1].percentile;
    }

    for (let i = 0; i < this.percentileLookup.length - 1; i++) {
      const lower = this.percentileLookup[i];
      const upper = this.percentileLookup[i + 1];

      if (score >= lower.score && score <= upper.score) {
        const scoreRange = upper.score - lower.score;
        if (scoreRange === 0) return lower.percentile;

        const t = (score - lower.score) / scoreRange;
        return Math.round(
          (lower.percentile + t * (upper.percentile - lower.percentile)) * 10
        ) / 10;
      }
    }

    return null;
  }

  getStats(): CalibrationData {
    return this.data;
  }
}

// Computed 2026-08-13 from a real calibration run: 7,938 of 8,000 positions
// scored at canonical tier (four verifiably-elite Lichess accounts, plies
// 10-80; 62 skipped as unanalyzable -- checkmate/near-terminal positions
// with no legal moves). Replaces the launch-time placeholder CDF (see the
// Decision log in docs/ROADMAP.md and docs/FOG_INDEX_METHODOLOGY.md).
export const FOG_CALIBRATION_V0_1: CalibrationData = {
  formulaVersion: '0.1',
  corpusSize: 7938,
  minScore: 2,
  maxScore: 100,
  mean: 44.2,
  stdDev: 11.3,
  percentiles: {
    '0.1': 10,
    '1': 20,
    '5': 24,
    '10': 28,
    '25': 37,
    '50': 46,
    '75': 50,
    '90': 57,
    '95': 62,
    '99': 71,
    '99.9': 94,
  },
};

export function getCalibration(
  formulaVersion: string = '0.1'
): FogCalibration {
  if (formulaVersion === '0.1') {
    return new FogCalibration(FOG_CALIBRATION_V0_1);
  }
  throw new Error(`Unknown formula version: ${formulaVersion}`);
}
