import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import LoginForm from '@/components/LoginForm';

export default async function HomePage() {
  // Check if already authenticated
  const authenticated = await isAuthenticated();
  
  if (authenticated) {
    redirect('/admin');
  }

  return <LoginForm />;
}
