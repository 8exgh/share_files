import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import AdminShell from '@/components/AdminShell';

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

  return <AdminShell>{children}</AdminShell>;
}
