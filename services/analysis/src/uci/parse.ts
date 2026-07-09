// Pure UCI protocol line parsing -- no I/O, no process state. Kept separate
// from uci/client.ts so it's unit-testable against committed transcript
// fixtures without spawning an engine.

export interface UciInfo {
  multipv?: number;
  depth?: number;
  seldepth?: number;
  nodes?: number;
  nps?: number;
  scoreCp?: number;
  scoreMate?: number;
  wdl?: { w: number; d: number; l: number };
  pv?: string[];
}

export interface UciBestMove {
  bestMove: string;
  ponder?: string;
}

/**
 * Parses one `info ...` line. Returns null for lines that aren't `info`
 * lines (e.g. `id`, `option`, `uciok`, `readyok`) so callers can filter a
 * raw stdout stream with a single check. `pv` and the UCI `string` field
 * run to the end of the line by protocol definition, so those consume every
 * remaining token; everything else is a fixed-arity key/value pair skipped
 * defensively for keys this parser doesn't need (currmove, hashfull, ...).
 */
export function parseInfoLine(line: string): UciInfo | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'info') return null;

  const info: UciInfo = {};
  let i = 1;
  while (i < tokens.length) {
    const key = tokens[i];
    switch (key) {
      case 'multipv':
        info.multipv = Number(tokens[i + 1]);
        i += 2;
        break;
      case 'depth':
        info.depth = Number(tokens[i + 1]);
        i += 2;
        break;
      case 'seldepth':
        info.seldepth = Number(tokens[i + 1]);
        i += 2;
        break;
      case 'nodes':
        info.nodes = Number(tokens[i + 1]);
        i += 2;
        break;
      case 'nps':
        info.nps = Number(tokens[i + 1]);
        i += 2;
        break;
      case 'score':
        if (tokens[i + 1] === 'cp') {
          info.scoreCp = Number(tokens[i + 2]);
        } else if (tokens[i + 1] === 'mate') {
          info.scoreMate = Number(tokens[i + 2]);
        }
        i += 3;
        break;
      case 'wdl':
        info.wdl = {
          w: Number(tokens[i + 1]),
          d: Number(tokens[i + 2]),
          l: Number(tokens[i + 3]),
        };
        i += 4;
        break;
      case 'pv':
        info.pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
      case 'string':
        i = tokens.length;
        break;
      default:
        // Unrecognized or not-needed key (currmove, hashfull, tbhits,
        // time, cpuload, lowerbound/upperbound qualifiers, ...): skip one
        // token defensively rather than mis-parsing its value as a key.
        i += 1;
    }
  }
  return info;
}

/** Parses a `bestmove <uci> [ponder <uci>]` line, or null if not one. */
export function parseBestMove(line: string): UciBestMove | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'bestmove' || !tokens[1]) return null;

  const ponderIdx = tokens.indexOf('ponder');
  return {
    bestMove: tokens[1],
    ...(ponderIdx !== -1 && tokens[ponderIdx + 1] ? { ponder: tokens[ponderIdx + 1] } : {}),
  };
}
