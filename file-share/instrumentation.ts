export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { cleanupExpiredFiles } = await import('./lib/storage');

    const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
    const MAX_AGE_MS = 60 * 60 * 1000;           // 1 hour

    console.log('[CLEANUP] Running initial cleanup...');
    const initialDeleted = await cleanupExpiredFiles(MAX_AGE_MS);
    console.log(`[CLEANUP] Initial cleanup complete. Deleted ${initialDeleted.length} files.`);

    setInterval(async () => {
      console.log('[CLEANUP] Running scheduled cleanup...');
      try {
        const deleted = await cleanupExpiredFiles(MAX_AGE_MS);
        console.log(`[CLEANUP] Scheduled cleanup complete. Deleted ${deleted.length} files.`);
      } catch (error) {
        console.error('[CLEANUP] Scheduled cleanup error:', error);
      }
    }, CLEANUP_INTERVAL_MS);

    console.log(`[CLEANUP] Scheduler started: every ${CLEANUP_INTERVAL_MS / 60000} minutes, max age ${MAX_AGE_MS / 60000} minutes.`);
  }
}
