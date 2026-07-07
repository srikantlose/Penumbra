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

export const FOG_CALIBRATION_V0_1: CalibrationData = {
  formulaVersion: '0.1',
  corpusSize: 100000,
  minScore: 0,
  maxScore: 100,
  mean: 45.3,
  stdDev: 24.8,
  percentiles: {
    '0.1': 0,
    '1': 5,
    '5': 12,
    '10': 18,
    '25': 30,
    '50': 45,
    '75': 62,
    '90': 78,
    '95': 87,
    '99': 94,
    '99.9': 99,
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
