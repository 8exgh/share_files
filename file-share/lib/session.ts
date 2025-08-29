import { SessionOptions } from 'iron-session';

export interface SessionData {
  isLoggedIn: boolean;
  isAdmin: boolean;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'file-share-session',
  ttl: 60 * 60 * 24, // 24 hours
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
  },
};