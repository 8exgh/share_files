'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const social = pathname.startsWith('/admin/social-posts');
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');

  const logout = async () => {
    setLoggingOut(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error();
      router.push('/'); router.refresh();
    } catch { setError('Could not log out. Please try again.'); setLoggingOut(false); }
  };

  return (
    <div className="min-h-screen flex-1 bg-gray-50">
      <header className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">{social ? 'Social Posts' : 'File Manager'}</h1>
          <button onClick={logout} disabled={loggingOut} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50">
            {loggingOut ? 'Logging out…' : 'Logout'}
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <nav aria-label="Admin sections" className="mt-6 flex gap-6 border-b border-gray-200">
          {[{ href: '/admin', label: 'Files', active: !social }, { href: '/admin/social-posts', label: 'Social Posts', active: social }].map(tab => (
            <Link key={tab.href} href={tab.href} aria-current={tab.active ? 'page' : undefined}
              className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${tab.active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}>
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
