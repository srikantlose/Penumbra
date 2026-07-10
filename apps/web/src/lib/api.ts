// Typed fetch helpers for every apps/api endpoint the web app consumes
// (docs/ROADMAP.md Stage 6). Server components call these directly; the
// /board fog-poll uses fetchFog client-side with its own retry loop (see
// useFogPoll.ts). Base URL is NEXT_PUBLIC_API_URL, defaulting to the local
// dev API.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface FogComponents {
  disagreement: number;
  depthVolatility: number;
  moveCriticality: number;
  tablebaseDistance: number;
  proofGate: number;
}

export type TruthStatus = 'EVALUATED' | 'PROVEN';

export interface FogReady {
  status: TruthStatus;
  score: number;
  components: FogComponents;
  percentile: number | null;
  percentile_provisional: true;
  fingerprint: string;
}

export interface FogPending {
  status: 'pending';
  retry_after_ms: number;
}

export type FogResult = FogReady | FogPending;

export interface EvalEntry {
  engine: string;
  engineVersion: string;
  netId: string | null;
  nodes: number | null;
  depth: number | null;
  multiPvRank: number | null;
  scoreCp: number | null;
  scoreMate: number | null;
  wdl: { wins: number | null; draws: number | null; losses: number | null };
  settings: unknown;
  engineFingerprint: string;
  createdAt: string;
}

export interface ProofRef {
  id: number;
  value: string;
  bound: string | null;
  status: string;
  certificateSha256: string | null;
  publishedAt: string | null;
}

export interface PositionDetail {
  epd: string;
  zobrist: string;
  pieceCount: number;
  provenance: { firstSeenGameId: number | null; occurrenceCount: number; createdAt: string };
  truthStatus: TruthStatus;
  fog: (Omit<FogReady, 'percentile_provisional'> & { percentileProvisional: true }) | null;
  evals: EvalEntry[];
  proofRefs: ProofRef[];
}

export interface ProofSummary {
  id: number;
  positionEpd: string;
  claim: unknown;
  value: string;
  bound: string | null;
  status: string;
  formatVersion: string;
  certificateSha256: string | null;
  downloadUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface LedgerEntry {
  seq: number;
  proofId: number | null;
  payload: unknown;
  prevHash: string | null;
  entryHash: string;
  createdAt: string;
}

export interface Methodology {
  formulaVersion: string;
  weights: {
    disagreement: number;
    depthVolatility: number;
    moveCriticality: number;
    tablebaseDistance: number;
  };
  engines: {
    stockfish: { version: string; nnue: string };
    lc0: { version: string; network: string; backend: string; nodes: number };
  };
  fingerprints: { quick: string; canonical: string };
  calibration: { corpus: 'provisional-placeholder'; corpusSize: number; formulaVersion: string };
}

export interface BffStats {
  positions: number;
  proofs: number;
  ledgerHeight: number;
  medianFog: number | null;
}

export interface FrontierBand {
  pieceCount: number;
  positions: number;
  proven: number;
  medianFog: number | null;
}

export interface BffImportResult {
  username: string;
  imported: number;
  gameIds: number[];
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchFog(fen: string): Promise<FogResult> {
  return apiGet<FogResult>(`/v1/fog?fen=${encodeURIComponent(fen)}`);
}

export async function fetchPosition(zobrist: string): Promise<PositionDetail | null> {
  const response = await fetch(`${API_BASE_URL}/v1/positions/${encodeURIComponent(zobrist)}`, {
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET /v1/positions/${zobrist} failed: ${response.status}`);
  return response.json() as Promise<PositionDetail>;
}

export interface RecentPosition {
  epd: string;
  zobrist: string;
  pieceCount: number;
  createdAt: string;
}

export async function fetchRecentPositions(limit = 20): Promise<{ positions: RecentPosition[] }> {
  return apiGet(`/v1/positions?limit=${limit}`);
}

export async function fetchProofs(params: { limit?: number; offset?: number } = {}): Promise<{
  proofs: ProofSummary[];
  total: number;
}> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return apiGet(`/v1/proofs${qs ? `?${qs}` : ''}`);
}

export async function fetchLedger(sinceSeq = 0): Promise<{ entries: LedgerEntry[] }> {
  return apiGet(`/v1/ledger?since_seq=${sinceSeq}`);
}

export async function fetchMethodology(): Promise<Methodology> {
  return apiGet('/v1/meta/methodology');
}

export async function fetchBffStats(): Promise<BffStats> {
  return apiGet('/bff/stats');
}

export async function fetchBffFrontier(): Promise<{ bands: FrontierBand[] }> {
  return apiGet('/bff/frontier');
}

/**
 * Server-only: /bff/import requires an X-API-Key, which the web server holds
 * (PENUMBRA_API_KEY, not NEXT_PUBLIC_-prefixed) so it never reaches the
 * browser. Only call this from a Server Action or route handler, never from
 * a 'use client' component.
 */
export async function postBffImport(username: string, max?: number): Promise<BffImportResult> {
  const apiKey = process.env.PENUMBRA_API_KEY;
  if (!apiKey) throw new Error('PENUMBRA_API_KEY is not set on the web server');

  const response = await fetch(`${API_BASE_URL}/bff/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ username, max }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `POST /bff/import failed: ${response.status}`);
  }
  return response.json() as Promise<BffImportResult>;
}

export interface FogTimelineEntry {
  ply: number;
  positionId: number;
  san: string;
  fog: number;
  percentile: number | null;
  status: TruthStatus;
  fingerprint: string;
}

export interface GameAnalysis {
  id: number;
  tier: string;
  status: string;
  fogTimeline: FogTimelineEntry[] | null;
  proofEntryPly: number | null;
  missedProofs: unknown;
  completedAt: string | null;
}

export interface Game {
  id: number;
  source: string;
  sourceGameId: string | null;
  white: string | null;
  black: string | null;
  result: string | null;
  importedAt: string;
  analysis: GameAnalysis | null;
}

export async function fetchGame(id: number): Promise<Game | null> {
  const response = await fetch(`${API_BASE_URL}/v1/games/${id}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET /v1/games/${id} failed: ${response.status}`);
  return response.json() as Promise<Game>;
}
