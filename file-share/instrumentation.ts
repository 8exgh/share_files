export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { cleanupExpiredFiles } = await import('./lib/storage');
    const { cleanupSessions } = await import('./lib/auth-state');
    const { cleanupAnonymousFiles } = await import('./lib/anonymous-files');

    const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
    const MAX_AGE_MS = 60 * 60 * 1000;           // 1 hour

    console.log('[CLEANUP] Running initial cleanup...');
    const initialDeleted = await cleanupExpiredFiles(MAX_AGE_MS);
    await cleanupSessions();
    await cleanupAnonymousFiles();
    console.log(`[CLEANUP] Initial cleanup complete. Deleted ${initialDeleted.length} files.`);

    setInterval(async () => {
      console.log('[CLEANUP] Running scheduled cleanup...');
      try {
        const deleted = await cleanupExpiredFiles(MAX_AGE_MS);
        await cleanupSessions();
        console.log(`[CLEANUP] Scheduled cleanup complete. Deleted ${deleted.length} files.`);
      } catch (error) {
        console.error('[CLEANUP] Scheduled cleanup error:', error);
      }
    }, CLEANUP_INTERVAL_MS);

    // Public links expire on every read; reclaim their bytes within a minute too.
    let cleaningAnonymous = false;
    setInterval(async () => {
      if (cleaningAnonymous) return;
      cleaningAnonymous = true;
      try { await cleanupAnonymousFiles(); }
      catch (error) { console.error('[CLEANUP] Anonymous file cleanup error:', error); }
      finally { cleaningAnonymous = false; }
    }, 60_000).unref();

    console.log(`[CLEANUP] Scheduler started: every ${CLEANUP_INTERVAL_MS / 60000} minutes, max age ${MAX_AGE_MS / 60000} minutes.`);
  }
}
