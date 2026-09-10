import type { FileHandle } from 'node:fs/promises';

// Read one bounded chunk per pull; close on EOF, failure or cancellation.
export function downloadStream(handle: FileHandle, signal: AbortSignal, release: () => void, range?: { start: number; end: number }) {
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let position = range?.start ?? 0;
  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    signal.removeEventListener('abort', onAbort);
    closePromise = handle.close().finally(release);
    return closePromise;
  };
  const onAbort = () => {
    if (!closed) controller.error(new Error('Download cancelled'));
    void close().catch(() => {});
  };
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    },
    async pull(value) {
      if (closed) return;
      try {
        const remaining = range ? range.end - position + 1 : Infinity;
        if (remaining <= 0) { await close(); value.close(); return; }
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        position += bytesRead;
        if (closed) return;
        if (bytesRead === 0) { await close(); value.close(); }
        else value.enqueue(buffer.subarray(0, bytesRead));
      } catch (error) {
        if (!closed) value.error(error);
        await close();
      }
    },
    cancel: close,
  }, { highWaterMark: 1 });
}
