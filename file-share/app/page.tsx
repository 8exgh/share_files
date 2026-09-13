import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import LoginForm from '@/components/LoginForm';
import AnonymousFiles from '@/components/AnonymousFiles';
import { MAX_FILE_SIZE, MAX_NOTE_SIZE } from '@/lib/security-config';

export default async function HomePage() {
  // Check if already authenticated
  const authenticated = await isAuthenticated();
  
  if (authenticated) {
    redirect('/admin');
  }

  return <div className="min-h-screen bg-gray-50">
    <AnonymousFiles maxFileSize={MAX_FILE_SIZE} maxNoteSize={MAX_NOTE_SIZE} />
    <div id="admin-login" className="border-t border-gray-200 [&>div]:min-h-0 [&>div]:px-4 [&>div]:py-12">
      <LoginForm />
    </div>
  </div>;
}
