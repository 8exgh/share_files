import { SessionOptions } from 'iron-session';
import { SESSION_TTL_SECONDS } from './security-config';

export interface SessionData {
  isLoggedIn: boolean;
  isAdmin: boolean;
  sessionId?: string;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'file-share-session',
  ttl: SESSION_TTL_SECONDS,
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
  },
};
