import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check authentication
  const authenticated = await isAuthenticated();
  
  if (!authenticated) {
    redirect('/');
  }

  return <>{children}</>;
}