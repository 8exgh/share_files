import SocialPosts from '@/components/SocialPosts';
import { MAX_FILE_SIZE } from '@/lib/security-config';

export default function SocialPostsPage() {
  return <SocialPosts maxFileSize={MAX_FILE_SIZE} />;
}
