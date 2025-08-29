import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { SessionData, sessionOptions } from './session';

export async function getSession() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  return session;
}

export async function login(username: string, password: string) {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (username === adminUsername && password === adminPassword) {
    const session = await getSession();
    session.isLoggedIn = true;
    session.isAdmin = true;
    await session.save();
    return true;
  }
  return false;
}

export async function logout() {
  const session = await getSession();
  session.destroy();
}

export async function isAuthenticated() {
  const session = await getSession();
  return session.isLoggedIn === true && session.isAdmin === true;
}