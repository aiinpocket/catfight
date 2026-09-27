import type { UnitDef } from '@catfight/engine';

export interface Me {
  id: number;
  username: string;
  displayName: string;
  points: number;
  unlockedUnits: string[];
  maxStage: number;
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
  unlocked: boolean;
  cleared: boolean;
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
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
  questions: (category: string, limit = 50, exclude: number[] = []) =>
    call<Question[]>('GET', `/api/questions?category=${encodeURIComponent(category)}&limit=${limit}${exclude.length ? `&exclude=${exclude.join(',')}` : ''}`),
  unlock: (unitId: string) => call<Me>('POST', '/api/unlock', { unitId }),
  opponent: (category: string) => call<Opponent>('POST', '/api/match/opponent', { category }),
  result: (r: MatchResultInput) => call<{ reward: number; ratingDelta: number; me: Me }>('POST', '/api/match/result', r),
  leaderboard: () => call<{ displayName: string; rating: number; wins: number; losses: number }[]>('GET', '/api/leaderboard'),
};
