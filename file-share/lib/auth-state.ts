import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { AUTH_MAX_ATTEMPTS, AUTH_WINDOW_MS, SECURITY_DIR, SESSION_TTL_SECONDS } from './security-config';
import { HttpError } from './http';

const SESSION_DIR = path.join(SECURITY_DIR, 'sessions');
const ATTEMPTS_PATH = path.join(SECURITY_DIR, 'auth-attempts.json');
const shared = globalThis as typeof globalThis & { fileShareAuthQueue?: Promise<void> };

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function credentialsVersion() {
  return createHmac('sha256', process.env.SESSION_SECRET!)
    .update(JSON.stringify([process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD])).digest('hex');
}

function equalSecret(input: string, expected: string) {
  return timingSafeEqual(createHash('sha256').update(input).digest(), createHash('sha256').update(expected).digest());
}

// This application runs one Node process with a persistent uploads volume.
// Serialize both auth entrypoints, including concurrent requests and route bundles.
export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const previous = shared.fileShareAuthQueue ?? Promise.resolve();
  let release!: () => void;
  shared.fileShareAuthQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    await fs.mkdir(SECURITY_DIR, { recursive: true, mode: 0o700 });
    const now = Date.now();
    let state = { failures: 0, resetAt: now + AUTH_WINDOW_MS };
    try {
      const saved = JSON.parse(await fs.readFile(ATTEMPTS_PATH, 'utf8'));
      if (!Number.isSafeInteger(saved.failures) || saved.failures < 0 || !Number.isSafeInteger(saved.resetAt)) {
        throw new Error('Invalid authentication attempt state');
      }
      if (saved.resetAt > now) state = saved;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    if (state.failures >= AUTH_MAX_ATTEMPTS) {
      throw new HttpError(429, 'Too many authentication attempts. Try again later.', {
        'Retry-After': String(Math.max(1, Math.ceil((state.resetAt - now) / 1000))),
      });
    }
    const expectedUser = process.env.ADMIN_USERNAME;
    const expectedPassword = process.env.ADMIN_PASSWORD;
    const userMatches = equalSecret(username, expectedUser || '');
    const passwordMatches = equalSecret(password, expectedPassword || '');
    const valid = Boolean(expectedUser && expectedPassword && userMatches && passwordMatches);
    if (valid) {
      await fs.rm(ATTEMPTS_PATH, { force: true });
    } else {
      state.failures++;
      const temporary = `${ATTEMPTS_PATH}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await fs.rename(temporary, ATTEMPTS_PATH);
    }
    return valid;
  } finally {
    release();
  }
}

export async function createSessionRecord(): Promise<string> {
  await fs.mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
  const id = randomBytes(32).toString('hex');
  await fs.writeFile(path.join(SESSION_DIR, id), JSON.stringify({
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    credentialsVersion: credentialsVersion(),
  }), { flag: 'wx', mode: 0o600 });
  return id;
}

export async function revokeSession(id?: string) {
  if (id && /^[a-f0-9]{64}$/.test(id)) await fs.rm(path.join(SESSION_DIR, id), { force: true });
}

export async function sessionIsValid(id?: string): Promise<boolean> {
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return false;
  try {
    const record = JSON.parse(await fs.readFile(path.join(SESSION_DIR, id), 'utf8'));
    return record.expiresAt > Date.now() && record.credentialsVersion === credentialsVersion();
  } catch (error) {
    if (missing(error) || error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function cleanupSessions() {
  await fs.mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
  for (const id of await fs.readdir(SESSION_DIR)) {
    if (/^[a-f0-9]{64}$/.test(id) && !await sessionIsValid(id)) await revokeSession(id);
  }
}
