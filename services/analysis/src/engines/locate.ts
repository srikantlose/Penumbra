import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LC0_NETWORK_FILENAME } from './config.js';

// This file lives two levels under services/analysis (src/engines or, once
// built, dist/engines), so the repo root is always four levels up --
// matches scripts/fetch-engines.mjs's default output directory.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, '..', '..', '..', '..');

export interface EngineExecutables {
  stockfishExePath: string;
  lc0ExePath: string;
  lc0WeightsFile: string;
}

export function locateEngines(
  enginesDir: string = process.env.PENUMBRA_ENGINES_DIR || path.join(defaultRepoRoot, 'engines')
): EngineExecutables {
  return {
    stockfishExePath: path.join(enginesDir, 'stockfish', 'stockfish.exe'),
    lc0ExePath: path.join(enginesDir, 'lc0', 'lc0.exe'),
    lc0WeightsFile: path.join(enginesDir, 'lc0', 'networks', LC0_NETWORK_FILENAME),
  };
}
