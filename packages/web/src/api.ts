import type { AiConfig, UnitDef, Upgrades, UpgradeTrack } from '@catfight/engine';

export interface Me {
  id: number;
  username: string;
  displayName: string;
  points: number;
  unlockedUnits: string[];
  clearedCount: number;
  upgrades: Upgrades;
  rating: { rating: number; wins: number; losses: number };
  stats: { category: string; games: number; wins: number; questions: number; correct: number; scorePerSec: number }[];
}

export interface Question {
  id: number;
  category: string;
  text: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
}

export interface StageInfo {
  id: number;
  name: string;
  category: string;
  reward: number;
  ai: AiConfig;
  boss: { unitId: string; name: string; desc: string; hp: number; dps: number; range: number };
  targetAccuracy: number;
  powerTier: number;
  unlocked: boolean;
  cleared: boolean;
}

export interface Category {
  id: string;
  name: string;
  count: number;
}

export interface Opponent {
  opponentId: number | null;
  displayName: string;
  scorePerSec: number;
  rating: number;
}

export interface MatchResultInput {
  mode: 'stage' | 'versus';
  category: string;
  stage?: number;
  opponentId?: number | null;
  won: boolean;
  score: number;
  seconds: number;
  questions: number;
  correct: number;
}

const TOKEN_KEY = 'catfight.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Called once whenever a request comes back 401 (token expired or revoked). Registered by main.ts. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/**
 * A finished battle whose result could not be recorded because the session had expired.
 * Kept in localStorage so it can be sent again right after the next login.
 */
const PENDING_KEY = 'catfight.pendingResult';
export function stashPendingResult(r: MatchResultInput) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable */
  }
}
export function takePendingResult(): MatchResultInput | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_KEY);
    return JSON.parse(raw) as MatchResultInput;
  } catch {
    return null;
  }
}

export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  // only claim a JSON body when there is one: Fastify rejects an empty body sent as application/json
  const headers: Record<string, string> = body === undefined ? {} : { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // a 401 on an authenticated call means the session is gone: drop the token and let the app go back to login.
    // login/register themselves also answer 401 on a wrong password; that is not a session expiry.
    if (res.status === 401 && t && !url.startsWith('/api/auth/')) {
      setToken(null);
      onUnauthorized?.();
    }
    throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  register: (username: string, displayName: string, password: string) =>
    call<{ token: string; me: Me }>('POST', '/api/auth/register', { username, displayName, password }),
  login: (username: string, password: string) => call<{ token: string; me: Me }>('POST', '/api/auth/login', { username, password }),
  me: () => call<Me>('GET', '/api/me'),
  units: () => call<UnitDef[]>('GET', '/api/units'),
  stages: () => call<StageInfo[]>('GET', '/api/stages'),
  categories: () => call<Category[]>('GET', '/api/categories'),
  questions: (category: string, limit = 50, exclude: number[] = []) =>
    call<Question[]>('GET', `/api/questions?category=${encodeURIComponent(category)}&limit=${limit}${exclude.length ? `&exclude=${exclude.join(',')}` : ''}`),
  unlock: (unitId: string) => call<Me>('POST', '/api/unlock', { unitId }),
  upgrade: (unitId: string, track: UpgradeTrack) => call<Me>('POST', '/api/upgrade', { unitId, track }),
  opponent: (category: string) => call<Opponent>('POST', '/api/match/opponent', { category }),
  heartbeat: () => call<{ ok: boolean }>('POST', '/api/battle/heartbeat'),
  result: (r: MatchResultInput) => call<{ reward: number; ratingDelta: number; me: Me }>('POST', '/api/match/result', r),
  leaderboard: () => call<{ displayName: string; rating: number; wins: number; losses: number }[]>('GET', '/api/leaderboard'),
};
