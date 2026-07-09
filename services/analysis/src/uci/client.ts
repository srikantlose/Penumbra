import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { parseBestMove, parseInfoLine, type UciBestMove, type UciInfo } from './parse.js';
import type { UciOptionValue } from '../engines/config.js';

export interface UciSearchResult {
  /** Last info line seen per multipv rank, keyed by rank (1-indexed). */
  infoByMultiPv: Map<number, UciInfo>;
  bestMove: UciBestMove;
}

const DEFAULT_SEARCH_TIMEOUT_MS = 10 * 60 * 1000;
const QUIT_GRACE_MS = 2000;

// Every UciClient with a live subprocess, so a process-wide shutdown (e.g.
// the worker's SIGINT/SIGTERM handler) can force-kill in-flight engines
// without waiting for their searches to finish naturally.
const activeClients = new Set<UciClient>();

/** Immediately terminates every live engine subprocess. For forced shutdown only -- prefer quit() during normal operation. */
export function killAllActiveEngines(): void {
  for (const client of activeClients) client.kill();
}

interface LineWaiter {
  predicate: (line: string) => boolean;
  resolve: (line: string) => void;
  reject: (err: Error) => void;
}

/**
 * Thin line-protocol wrapper around a UCI engine subprocess. One client per
 * engine instance: init() once, then any number of goNodes() calls in
 * sequence (e.g. one per ladder rung), then quit(). goNodes() calls must
 * not overlap on the same instance -- callers running engines in parallel
 * use separate UciClient instances (separate subprocesses).
 */
export class UciClient {
  private readonly exePath: string;
  private readonly cwd: string | undefined;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private exited = false;
  private waiters: LineWaiter[] = [];
  // Set only while a goNodes() search is in flight; every info line for
  // that search is captured here by the single shared stdout listener.
  private activeInfoCapture: Map<number, UciInfo> | null = null;

  constructor(exePath: string, opts?: { cwd?: string }) {
    this.exePath = exePath;
    this.cwd = opts?.cwd;
  }

  private ensureStarted(): void {
    if (this.proc) return;

    const proc = spawn(this.exePath, [], { cwd: this.cwd });
    this.proc = proc;
    activeClients.add(this);

    createInterface({ input: proc.stdout }).on('line', (line) => this.handleLine(line));

    const onTerminated = (reason: string) => {
      this.exited = true;
      activeClients.delete(this);
      this.rejectAllWaiters(new Error(`${this.exePath} ${reason}`));
    };
    proc.on('exit', (code) => onTerminated(`exited (code ${code}) before expected output`));
    proc.on('error', (err) => onTerminated(`failed to start: ${err.message}`));
  }

  private handleLine(line: string): void {
    if (this.activeInfoCapture) {
      const info = parseInfoLine(line);
      if (info) {
        this.activeInfoCapture.set(info.multipv ?? 1, info);
      }
    }

    const remaining: LineWaiter[] = [];
    for (const waiter of this.waiters) {
      if (waiter.predicate(line)) {
        waiter.resolve(line);
      } else {
        remaining.push(waiter);
      }
    }
    this.waiters = remaining;
  }

  private rejectAllWaiters(err: Error): void {
    for (const waiter of this.waiters) waiter.reject(err);
    this.waiters = [];
  }

  private waitForLine(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
    if (this.exited) {
      return Promise.reject(new Error(`${this.exePath} has already exited`));
    }
    return new Promise((resolve, reject) => {
      const waiter: LineWaiter = {
        predicate,
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for engine output`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  private send(command: string): void {
    if (!this.proc?.stdin.writable) {
      throw new Error(`cannot write to ${this.exePath}: stdin not writable`);
    }
    this.proc.stdin.write(command + '\n');
  }

  async init(options: Record<string, UciOptionValue>): Promise<void> {
    this.ensureStarted();
    this.send('uci');
    await this.waitForLine((l) => l.trim() === 'uciok', 30_000);

    for (const [name, value] of Object.entries(options)) {
      this.send(`setoption name ${name} value ${value}`);
    }

    this.send('isready');
    await this.waitForLine((l) => l.trim() === 'readyok', 30_000);
  }

  async goNodes(fen: string, nodes: number, timeoutMs = DEFAULT_SEARCH_TIMEOUT_MS): Promise<UciSearchResult> {
    this.send('ucinewgame');
    this.send('isready');
    await this.waitForLine((l) => l.trim() === 'readyok', 30_000);

    const infoByMultiPv = new Map<number, UciInfo>();
    this.activeInfoCapture = infoByMultiPv;

    this.send(`position fen ${fen}`);
    this.send(`go nodes ${nodes}`);

    let bestMoveLine: string;
    try {
      bestMoveLine = await this.waitForLine((l) => l.trim().startsWith('bestmove'), timeoutMs);
    } finally {
      this.activeInfoCapture = null;
    }

    const bestMove = parseBestMove(bestMoveLine);
    if (!bestMove) {
      throw new Error(`engine produced an unparseable bestmove line: "${bestMoveLine}"`);
    }

    return { infoByMultiPv, bestMove };
  }

  async quit(): Promise<void> {
    const proc = this.proc;
    if (!proc || this.exited) return;

    this.send('quit');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // Windows has no POSIX signal semantics -- kill() maps to
        // TerminateProcess there regardless of signal name, which is the
        // only reliable way to guarantee the child is gone.
        proc.kill();
        resolve();
      }, QUIT_GRACE_MS);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Immediately terminates the subprocess without sending `quit`. For forced shutdown only. */
  kill(): void {
    this.proc?.kill();
  }
}
