import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { SessionData, sessionOptions } from './session';
import { createSessionRecord, revokeSession, sessionIsValid, verifyCredentials } from './auth-state';

export async function getSession() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  return session;
}

export async function login(username: string, password: string) {
  if (await verifyCredentials(username, password)) {
    const session = await getSession();
    await revokeSession(session.sessionId);
    session.sessionId = await createSessionRecord();
    session.isLoggedIn = true;
    session.isAdmin = true;
    try {
      await session.save();
    } catch (error) {
      await revokeSession(session.sessionId);
      throw error;
    }
    return true;
  }
  return false;
}

export async function hasValidBasicAuth(authorization: string | null) {
  if (!authorization || !/^Basic /i.test(authorization)) return false;
  if (authorization.length > 4096) return verifyCredentials('', '');
  const decoded = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return verifyCredentials('', '');
  return verifyCredentials(decoded.slice(0, separator), decoded.slice(separator + 1));
}

export async function logout() {
  const session = await getSession();
  await revokeSession(session.sessionId);
  session.destroy();
}

export async function isAuthenticated() {
  const session = await getSession();
  return session.isLoggedIn === true && session.isAdmin === true && await sessionIsValid(session.sessionId);
}
