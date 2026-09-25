/** 기기 로컬 세션. 토큰은 인증 수단이며 닉네임은 아니다. */
export interface StudentSession {
  code: string;
  playerId: string;
  token: string;
  nick: string;
  role: 'student' | 'spectator' | 'teacher';
}

const KEY = 'rg.session';
const TEACHER_KEY = 'rg.teacherKey';
const RECENT_KEY = 'rg.recentRooms';

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string | null): void {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {}
}

export function loadSession(): StudentSession | null {
  const raw = safeGet(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as StudentSession; } catch { return null; }
}
export function saveSession(s: StudentSession | null): void {
  safeSet(KEY, s ? JSON.stringify(s) : null);
}
export function loadTeacherKey(): string | null { return safeGet(TEACHER_KEY); }
export function saveTeacherKey(k: string | null): void { safeSet(TEACHER_KEY, k); }

export interface RecentRoom { code: string; teacherToken: string; playerId: string; at: number; mode: string }
export function loadRecentRooms(): RecentRoom[] {
  try { return JSON.parse(safeGet(RECENT_KEY) ?? '[]') as RecentRoom[]; } catch { return []; }
}
export function rememberRoom(r: RecentRoom): void {
  const list = [r, ...loadRecentRooms().filter((x) => x.code !== r.code)].slice(0, 8);
  safeSet(RECENT_KEY, JSON.stringify(list));
}

export function roomFromUrl(): string | null {
  try {
    const u = new URL(location.href);
    const c = (u.searchParams.get('room') ?? '').toUpperCase();
    return /^[A-Z0-9]{6}$/.test(c) ? c : null;
  } catch { return null; }
}

export function prefGet(key: string, def: string): string {
  return safeGet(`rg.pref.${key}`) ?? def;
}
export function prefSet(key: string, v: string): void {
  safeSet(`rg.pref.${key}`, v);
}
