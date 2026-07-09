// Downloads the pinned Stockfish + Lc0 Windows builds and a pinned Lc0
// network file needed by services/analysis (Stage 3 UCI worker), extracts
// them into gitignored engines/, and verifies every file's sha256 -- both
// right after download and again on every subsequent run (a cheap re-hash
// of three files, unlike Syzygy's hundreds). Idempotent: a component whose
// final artifact already exists and hashes correctly is left alone. Writes
// engines/manifest.json on success.
//
// Zip extraction shells out to the real Windows bsdtar at
// C:\Windows\System32\tar.exe (ships since Windows 10 1803, understands
// .zip) rather than Git Bash's GNU tar, which cannot read zip archives.
//
// Usage: node scripts/fetch-engines.mjs [--dir=<output-dir>]
// Exit 0 once every pinned file is installed and verified; exit 1 on any
// download, extraction, or hash-verification failure.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Pinned 2026-07-09. See docs/ENGINES.md for the full pin table and
// rationale. Re-pinning is a deliberate act: a different engine build
// changes evaluation output, which changes computeEngineFingerprint(),
// which starts a new fog_scores lineage -- never bump casually.
const STOCKFISH = {
  version: 'sf_18',
  asset: 'stockfish-windows-x86-64-avx2.zip',
  url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_18/stockfish-windows-x86-64-avx2.zip',
  size: 76955020,
  sha256: '6f6c272ebd6ea594377715235c8a7326f75940ef4f4f856f45106028fe6ae900',
};

// The CPU (OpenBLAS) build, not a CUDA build: repro-test found the CUDA
// `cuda` backend non-deterministic (GPU batched-eval timing races, not
// fixed by MinibatchSize=1), and this build's `blas` backend verified
// byte-identical across repeated runs. See docs/ENGINES.md and
// services/analysis's engines/config.ts (LC0_BACKEND).
const LC0 = {
  version: 'v0.32.1',
  asset: 'lc0-v0.32.1-windows-cpu-openblas.zip',
  url: 'https://github.com/LeelaChessZero/lc0/releases/download/v0.32.1/lc0-v0.32.1-windows-cpu-openblas.zip',
  size: 23818982,
  sha256: 'b2caa8443f0e0cb15cf76c335c53985f2973cd6438e77d3e2366cd21d2effa38',
};

// A small "distilled" network (trained to approximate a much larger net's
// output at a fraction of the size), not the strongest available contrib
// net: CPU inference cost turned out to be dominated by per-node backend
// overhead, not network size (a ~380MB top net and this ~37MB one both
// took minutes per search at 30k nodes on this machine's CPU) -- so a
// bigger network wouldn't have bought meaningfully more speed, only a
// smaller one buys headroom to run more nodes per position within a
// practical time budget. See docs/ENGINES.md for the timing data and
// the resulting node-count decision.
//
// lczero.org's network storage does not publish sha256 alongside network
// files, so this hash was pinned from this script's own first verified
// download rather than an upstream-published value.
const LC0_NETWORK = {
  id: 't1-256x10-distilled-swa-2432500',
  url: 'https://storage.lczero.org/files/networks-contrib/t1-256x10-distilled-swa-2432500.pb.gz',
  filename: 't1-256x10-distilled-swa-2432500.pb.gz',
  size: 37118673,
  sha256: 'bc27a6cae8ad36f2b9a80a6ad9dabb0d6fda25b1e7f481a79bc359e14f563406',
};

const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const BSDTAR = 'C:\\Windows\\System32\\tar.exe';

function argValue(flag) {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const outDir = path.resolve(repoRoot, argValue('dir') || 'engines');
const archiveDir = path.join(outDir, '_archives');
const manifestPath = path.join(outDir, 'manifest.json');

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function existingSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return null;
  }
}

async function sha256File(filePath) {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function downloadOnce(url, destPath, expectedSize) {
  console.log(`  downloading (${(expectedSize / 1e6).toFixed(0)} MB)...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
  const tmpPath = `${destPath}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmpPath));
  const finalSize = await existingSize(tmpPath);
  if (finalSize !== expectedSize) {
    await rm(tmpPath, { force: true });
    throw new Error(`downloaded ${finalSize ?? 0} bytes, expected ${expectedSize}`);
  }
  await rename(tmpPath, destPath);
}

// Downloads to destPath (skipping if a same-size, correctly-hashed file is
// already there) and returns the verified sha256. expectedSha256 === null
// means "not yet pinned" -- the hash is computed and reported but not
// checked, for the one-time bootstrap run that establishes the pin.
async function fetchAndVerify(label, url, expectedSize, expectedSha256, destPath) {
  await mkdir(path.dirname(destPath), { recursive: true });

  if ((await existingSize(destPath)) === expectedSize) {
    const hash = await sha256File(destPath);
    if (!expectedSha256 || hash === expectedSha256) {
      console.log(`  ${label}: already present, sha256 verified`);
      return { sha256: hash, status: 'skipped' };
    }
    console.warn(`  ${label}: size matches but sha256 differs (have ${hash}, want ${expectedSha256}) -- re-downloading`);
  }

  await downloadOnce(url, destPath, expectedSize);
  const hash = await sha256File(destPath);
  if (expectedSha256 && hash !== expectedSha256) {
    await rm(destPath, { force: true });
    throw new Error(`${label}: sha256 mismatch (got ${hash}, expected ${expectedSha256})`);
  }
  if (!expectedSha256) {
    console.warn(`  ${label}: no pinned sha256 yet -- computed ${hash}. Pin this in fetch-engines.mjs and docs/ENGINES.md.`);
  }
  return { sha256: hash, status: 'downloaded' };
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(BSDTAR, ['-xf', zipPath, '-C', destDir]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exit ${code}: ${stderr}`))));
  });
}

async function listFilesRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

// Extracts a zip into a scratch dir, then flat-copies every regular file it
// contains into destDir (ignoring the archive's internal folder nesting --
// Stockfish wraps its exe in a stockfish/ folder, Lc0's layout has varied
// across releases, so this is robust to either).
async function extractFlat(zipPath, destDir) {
  const scratchDir = `${destDir}.extract-tmp`;
  await rm(scratchDir, { recursive: true, force: true });
  await mkdir(scratchDir, { recursive: true });
  await extractZip(zipPath, scratchDir);

  await mkdir(destDir, { recursive: true });
  const files = await listFilesRecursive(scratchDir);
  for (const file of files) {
    await copyFile(file, path.join(destDir, path.basename(file)));
  }
  await rm(scratchDir, { recursive: true, force: true });
  return files.map((f) => path.basename(f));
}

async function ensureStockfish() {
  console.log('stockfish:');
  const exePath = path.join(outDir, 'stockfish', 'stockfish.exe');
  if (await pathExists(exePath)) {
    console.log('  already installed');
    return { component: 'stockfish', ...STOCKFISH, installedAt: exePath };
  }

  const archivePath = path.join(archiveDir, STOCKFISH.asset);
  await fetchAndVerify('stockfish archive', STOCKFISH.url, STOCKFISH.size, STOCKFISH.sha256, archivePath);

  const destDir = path.join(outDir, 'stockfish');
  const names = await extractFlat(archivePath, destDir);
  const exeName = names.find((n) => /^stockfish.*\.exe$/i.test(n));
  if (!exeName) throw new Error(`stockfish executable not found among extracted files: ${names.join(', ')}`);
  if (exeName !== 'stockfish.exe') {
    await rename(path.join(destDir, exeName), exePath);
  }

  console.log(`  installed -> ${path.relative(repoRoot, exePath)}`);
  return { component: 'stockfish', ...STOCKFISH, installedAt: exePath };
}

async function ensureLc0() {
  console.log('lc0:');
  const exePath = path.join(outDir, 'lc0', 'lc0.exe');
  if (await pathExists(exePath)) {
    console.log('  already installed');
  } else {
    const archivePath = path.join(archiveDir, LC0.asset);
    await fetchAndVerify('lc0 archive', LC0.url, LC0.size, LC0.sha256, archivePath);

    const destDir = path.join(outDir, 'lc0');
    const names = await extractFlat(archivePath, destDir);
    if (!names.includes('lc0.exe')) {
      throw new Error(`lc0.exe not found among extracted files: ${names.join(', ')}`);
    }
    console.log(`  installed -> ${path.relative(repoRoot, exePath)} (+ ${names.length - 1} DLL/support files)`);
  }

  const networkPath = path.join(outDir, 'lc0', 'networks', LC0_NETWORK.filename);
  const netResult = await fetchAndVerify(
    'lc0 network',
    LC0_NETWORK.url,
    LC0_NETWORK.size,
    LC0_NETWORK.sha256,
    networkPath
  );

  return {
    component: 'lc0',
    ...LC0,
    network: { ...LC0_NETWORK, sha256: netResult.sha256, installedAt: networkPath },
    installedAt: exePath,
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const results = [];
  results.push(await ensureStockfish());
  results.push(await ensureLc0());

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        components: results.map((r) => ({
          component: r.component,
          version: r.version,
          url: r.url,
          sha256: r.sha256,
          installedAt: path.relative(repoRoot, r.installedAt),
          ...(r.network
            ? {
                network: {
                  id: r.network.id,
                  url: r.network.url,
                  sha256: r.network.sha256,
                  installedAt: path.relative(repoRoot, r.network.installedAt),
                },
              }
            : {}),
        })),
      },
      null,
      2
    ) + '\n'
  );

  console.log(`\ndone. manifest written to ${path.relative(repoRoot, manifestPath)}`);
}

main().catch((err) => {
  console.error('fetch-engines failed:', err.message);
  process.exit(1);
});
