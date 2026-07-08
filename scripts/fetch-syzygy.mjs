// Downloads the 3-4-5-man Syzygy WDL (.rtbw) + DTZ (.rtbz) tablebases needed by
// the Stage 2 fortress track (rust/prover's TbOracle for at_least_draw proving,
// rust/verifier's TbOracle for --syzygy probing). Idempotent: a file already
// present at its expected remote size is skipped, so re-running only fetches
// what's missing or incomplete. Writes tablebases/manifest.json (file list,
// sizes, fetch date) on success.
//
// Usage: node scripts/fetch-syzygy.mjs [--dir=<output-dir>] [--concurrency=N]
// Exit 0 once every file is present and verified; exit 1 if any file could not
// be fetched from either the primary host or the mirror.

import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Primary host splits WDL and DTZ into separate directories.
const PRIMARY = {
  wdl: 'https://tablebase.lichess.ovh/tables/standard/3-4-5-wdl/',
  dtz: 'https://tablebase.lichess.ovh/tables/standard/3-4-5-dtz/',
};
// Mirror uses a single flat directory holding both extensions; best-effort
// per-file fallback only, tried when the primary host fails for that file.
const MIRROR_BASE = 'https://tablebase.sesse.net/syzygy/3-4-5/';

const LIST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;

function argValue(flag) {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const outDir = path.resolve(repoRoot, argValue('dir') || 'tablebases/syzygy/3-4-5');
const manifestPath = path.resolve(repoRoot, 'tablebases/manifest.json');
const concurrency = Number(argValue('concurrency')) || 6;

// nginx autoindex row: <a href="NAME">NAME</a>   DD-Mon-YYYY  HH:MM   SIZE
const ROW_RE = /<a href="([^"/]+\.(rtbw|rtbz))">[^<]+<\/a>\s+\S+\s+\S+\s+(\d+)/g;

async function listDirectory(indexUrl, expectedExt) {
  const res = await fetch(indexUrl, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${indexUrl} -> ${res.status}`);
  const html = await res.text();
  const files = [];
  for (const match of html.matchAll(ROW_RE)) {
    const [, name, ext, size] = match;
    if (ext !== expectedExt) continue;
    files.push({ name, size: Number(size) });
  }
  if (files.length === 0) throw new Error(`no .${expectedExt} entries found at ${indexUrl}`);
  return files;
}

async function existingSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return null;
  }
}

async function downloadOnce(url, destPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`);
  const tmpPath = `${destPath}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmpPath));
  await rename(tmpPath, destPath);
}

async function fetchFile(name, expectedSize, primaryUrl) {
  const destPath = path.join(outDir, name);
  if ((await existingSize(destPath)) === expectedSize) {
    return { name, size: expectedSize, status: 'skipped' };
  }

  try {
    await downloadOnce(primaryUrl, destPath);
  } catch (primaryErr) {
    try {
      await downloadOnce(`${MIRROR_BASE}${name}`, destPath);
    } catch (mirrorErr) {
      await rm(`${destPath}.part`, { force: true });
      throw new Error(`${name}: primary failed (${primaryErr.message}); mirror failed (${mirrorErr.message})`);
    }
  }

  const finalSize = await existingSize(destPath);
  if (finalSize !== expectedSize) {
    throw new Error(`${name}: downloaded ${finalSize ?? 0} bytes, expected ${expectedSize}`);
  }
  return { name, size: expectedSize, status: 'downloaded' };
}

async function runPool(items, worker, poolSize) {
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(poolSize, items.length) }, runner));
}

async function main() {
  await mkdir(outDir, { recursive: true });

  console.log('listing remote directories...');
  const [wdlFiles, dtzFiles] = await Promise.all([
    listDirectory(PRIMARY.wdl, 'rtbw'),
    listDirectory(PRIMARY.dtz, 'rtbz'),
  ]);
  const jobs = [
    ...wdlFiles.map((f) => ({ ...f, primaryUrl: `${PRIMARY.wdl}${f.name}` })),
    ...dtzFiles.map((f) => ({ ...f, primaryUrl: `${PRIMARY.dtz}${f.name}` })),
  ];
  console.log(`found ${wdlFiles.length} WDL + ${dtzFiles.length} DTZ files (${jobs.length} total)`);

  let downloaded = 0;
  let skipped = 0;
  const failures = [];
  const manifestFiles = [];

  await runPool(
    jobs,
    async (job, i) => {
      try {
        const result = await fetchFile(job.name, job.size, job.primaryUrl);
        if (result.status === 'downloaded') downloaded++;
        else skipped++;
        manifestFiles.push({ name: result.name, size: result.size });
      } catch (err) {
        failures.push(err.message);
        console.error(`FAILED: ${err.message}`);
      }
      if ((i + 1) % 20 === 0 || i === jobs.length - 1) {
        console.log(`progress: ${i + 1}/${jobs.length}`);
      }
    },
    concurrency
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} file(s) failed to download.`);
    process.exit(1);
  }

  manifestFiles.sort((a, b) => a.name.localeCompare(b.name));
  const totalBytes = manifestFiles.reduce((sum, f) => sum + f.size, 0);
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        primary: [PRIMARY.wdl, PRIMARY.dtz],
        mirror: MIRROR_BASE,
        fetchedAt: new Date().toISOString(),
        fileCount: manifestFiles.length,
        totalBytes,
        files: manifestFiles,
      },
      null,
      2
    ) + '\n'
  );

  console.log(
    `\ndone: ${downloaded} downloaded, ${skipped} already present, ${manifestFiles.length} total (${(
      totalBytes / 1e6
    ).toFixed(0)} MB)`
  );
  console.log(`manifest written to ${path.relative(repoRoot, manifestPath)}`);
}

main().catch((err) => {
  console.error('fetch-syzygy failed:', err.message);
  process.exit(1);
});
