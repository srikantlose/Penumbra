// Shells out to the compiled `penumbra-verify` binary to check a submitted
// certificate before it's allowed anywhere near publishProof() -- see
// docs/FLEET_DESIGN.md §5.3/§5.4. The real semantic verifier (move replay,
// AND-node coverage, checkmate/stalemate truth, cycle discipline, tablebase
// soundness) exists only in rust/verifier; this project's own design
// invariant is that verification logic is never duplicated, so reusing the
// tested binary as a subprocess is the deliberate choice over writing a
// second TypeScript verifier. Precedented by services/analysis's UciClient,
// which already spawns and manages native engine subprocesses from Node.
//
// Unlike UciClient, penumbra-verify is a one-shot batch CLI (run, print a
// report, exit), not an interactive protocol -- execFile is sufficient, no
// line-protocol/timeout-guard machinery needed.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/api/dist -> apps/api -> apps -> repo root.
const repoRoot = path.resolve(__dirname, '../../..');

export interface VerifyCliResult {
  valid: boolean;
  sha256: string | null;
  errors: string[];
  /** Full stdout, for logging/debugging -- not returned to submitters verbatim. */
  raw: string;
}

/**
 * Locates the `penumbra-verify` binary: `PENUMBRA_VERIFY_BIN` if set
 * (production/CI should pin this explicitly), otherwise the first of the
 * usual cargo output locations that actually exists. Throws with a
 * `cargo build` hint rather than silently treating "binary missing" as
 * "certificate invalid" -- those must never be confused, since the second
 * one is a submitter's fault and the first is an operator's.
 */
export function resolveVerifyBinaryPath(): string {
  const override = process.env.PENUMBRA_VERIFY_BIN;
  if (override) return override;

  const exeSuffix = os.platform() === 'win32' ? '.exe' : '';
  const candidates = ['release', 'debug'].map((profile) =>
    path.join(repoRoot, 'target', profile, `penumbra-verify${exeSuffix}`)
  );
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;

  throw new Error(
    `penumbra-verify binary not found (looked in: ${candidates.join(', ')}). ` +
      `Build it with "cargo build -p penumbra-verify --release" (or set PENUMBRA_VERIFY_BIN).`
  );
}

/** Parses the `penumbra-verify verify` report for the fields callers need; see rust/verifier/src/main.rs's verify_certificate for the exact print format. */
function parseReport(stdout: string): { sha256: string | null; errors: string[] } {
  const sha256Match = stdout.match(/^SHA256: (.+)$/m);
  const errors: string[] = [];
  const errorsIdx = stdout.indexOf('\nErrors:');
  if (errorsIdx !== -1) {
    for (const line of stdout.slice(errorsIdx).split('\n')) {
      const m = line.match(/^\s+-\s+(.+)$/);
      if (m) errors.push(m[1]);
    }
  }
  return { sha256: sha256Match?.[1] ?? null, errors };
}

/**
 * Runs `penumbra-verify verify <tempfile>` against `certificateJson` (plain
 * JSON text, no PNBC container needed -- the verifier reads legacy
 * no-prefix certificates exactly like any other, per
 * rust/verifier/src/container.rs) and reports whether it's a sound proof.
 * This is the ONLY gate a Fleet submission needs to pass to be publishable
 * -- no lighter or heavier path for a "trusted" submitter (see
 * docs/FLEET_DESIGN.md §5.5).
 */
export async function verifyCertificateJson(certificateJson: string): Promise<VerifyCliResult> {
  const binaryPath = resolveVerifyBinaryPath();
  const dir = await mkdtemp(path.join(tmpdir(), 'pnbc-fleet-'));
  const certPath = path.join(dir, 'submission.pnbcert');

  try {
    await writeFile(certPath, certificateJson, 'utf8');

    try {
      const { stdout } = await execFileAsync(binaryPath, ['verify', certPath], { timeout: 60_000 });
      const { sha256, errors } = parseReport(stdout);
      return { valid: true, sha256, errors, raw: stdout };
    } catch (err) {
      // execFile rejects on nonzero exit -- exit 1 is the CLI's normal,
      // documented "invalid certificate" signal (main.rs's ExitCode::FAILURE
      // branch), not an execution failure. Anything else (ENOENT, timeout,
      // a signal) re-throws, since that's a real operational problem, not a
      // verdict on the submitted certificate.
      const execErr = err as NodeJS.ErrnoException & { code?: number | string; stdout?: string };
      if (typeof execErr.code === 'number') {
        const { sha256, errors } = parseReport(execErr.stdout ?? '');
        return { valid: false, sha256, errors, raw: execErr.stdout ?? '' };
      }
      throw err;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
