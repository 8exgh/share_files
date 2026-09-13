'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { AnonymousFile } from '@/types';

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function timeLeft(expiresAt: string, now: number) {
  const minutes = Math.max(1, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left` : `${minutes}m left`;
}

export default function AnonymousFiles({ maxFileSize, maxNoteSize }: { maxFileSize: number; maxNoteSize: number }) {
  const [files, setFiles] = useState<AnonymousFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [noteError, setNoteError] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [noteName, setNoteName] = useState('');
  const [content, setContent] = useState('');
  const [created, setCreated] = useState<AnonymousFile | null>(null);
  const [copied, setCopied] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const response = await fetch('/api/anonymous-files', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not load files');
      if (current === sequence.current) setFiles(data.data);
    } catch (err) { if (current === sequence.current) setError(err instanceof Error ? err.message : 'Could not load files'); }
    finally { if (current === sequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const refresh = setInterval(() => void load(), 30_000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(refresh); clearInterval(clock); sequence.current++; };
  }, [load]);
  useEffect(() => { if (showNote) noteRef.current?.focus(); }, [showNote]);

  const published = (file: AnonymousFile) => {
    sequence.current++; setLoading(false); setNow(Date.now());
    setFiles(current => [file, ...current.filter(item => item.id !== file.id)]);
    setCreated(file); setCopied('');
  };
  const upload = async (file: File) => {
    if (uploadLock.current) return;
    setError('');
    if (file.size > maxFileSize) { setError(`Choose a file up to ${sizeLabel(maxFileSize)}.`); return; }
    uploadLock.current = true; setUploading(true);
    const body = new FormData(); body.append('file', file);
    try {
      const response = await fetch('/api/anonymous-files', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Upload failed');
      published(data.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed. Please try again.'); }
    finally { setUploading(false); uploadLock.current = false; if (inputRef.current) inputRef.current.value = ''; }
  };
  const createNote = async (event: FormEvent) => {
    event.preventDefault(); setNoteError('');
    if (!content.trim()) { setNoteError('Note content cannot be empty.'); return; }
    if (new TextEncoder().encode(content).length > maxNoteSize) { setNoteError(`Keep your note under ${sizeLabel(maxNoteSize)}.`); return; }
    setSaving(true);
    try {
      const response = await fetch('/api/anonymous-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, name: noteName.trim() || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not create note');
      published(data.data); setContent(''); setNoteName(''); setShowNote(false);
    } catch (err) { setNoteError(err instanceof Error ? err.message : 'Could not create note'); }
    finally { setSaving(false); }
  };
  const copyLink = async (file: AnonymousFile) => {
    try { await navigator.clipboard.writeText(new URL(file.viewUrl || file.downloadUrl, window.location.origin).href); setCopied(file.id); }
    catch { setError('Could not copy the link. Use the View note or Download link instead.'); }
  };
  const visible = files.filter(file => Date.parse(file.expiresAt) > now);
  const activeCreated = created && Date.parse(created.expiresAt) > now ? created : null;

  return <section aria-labelledby="anonymous-heading" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <span className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">24-hour sharing</span>
        <h1 id="anonymous-heading" className="mt-4 text-3xl font-bold tracking-tight text-gray-900">Anonymous files</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">Share a file or a quick note without signing in. Everything here is public and automatically expires after 24 hours.</p>
      </div>
      <a href="#admin-login" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Admin sign in</a>
    </div>

    <div className="mt-7 grid gap-4 md:grid-cols-2">
      <div onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void upload(file); }}
        className={`rounded-xl border-2 border-dashed p-6 ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white'}`}>
        <h2 className="font-semibold text-gray-900">Upload a file</h2>
        <p className="mt-2 text-sm leading-6 text-gray-500">Drop a file here, or choose one from your device.</p>
        <input ref={inputRef} aria-label="Anonymous file" type="file" className="sr-only" tabIndex={-1} disabled={uploading}
          onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        <button onClick={() => inputRef.current?.click()} disabled={uploading} className="mt-5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{uploading ? 'Uploading…' : 'Choose file'}</button>
        <p className="mt-3 text-xs text-gray-500">Any file, up to {sizeLabel(maxFileSize)}. Expires in 24 hours.</p>
        {uploading && <p role="status" className="mt-2 text-sm text-indigo-700">Uploading and calculating the file hash…</p>}
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="font-semibold text-gray-900">Share a note</h2>
        <p className="mt-2 text-sm leading-6 text-gray-500">Paste text and get a link anyone can view. Your note joins the public list below.</p>
        <button onClick={() => setShowNote(value => !value)} aria-expanded={showNote} aria-controls="anonymous-note-form" disabled={saving}
          className="mt-5 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">{showNote ? 'Close note form' : 'Create anonymous note'}</button>
        <p className="mt-3 text-xs text-gray-500">Plain text, up to {sizeLabel(maxNoteSize)}. Expires in 24 hours.</p>
      </div>
    </div>

    {showNote && <form id="anonymous-note-form" onSubmit={createNote} aria-label="Create anonymous note" className="mt-4 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-900">Create anonymous note</h2>
      <label htmlFor="anonymous-note-name" className="mt-4 block text-sm font-medium text-gray-700">Name <span className="font-normal text-gray-500">(optional)</span></label>
      <input ref={noteRef} id="anonymous-note-name" value={noteName} onChange={event => setNoteName(event.target.value)} maxLength={200} disabled={saving}
        placeholder="Give your note a name" className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-indigo-500" />
      <label htmlFor="anonymous-note-content" className="mt-4 block text-sm font-medium text-gray-700">Content</label>
      <textarea id="anonymous-note-content" value={content} onChange={event => setContent(event.target.value)} rows={6} required maxLength={maxNoteSize} disabled={saving}
        placeholder="Type or paste your note here…" className="mt-2 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-indigo-500" />
      {noteError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{noteError}</p>}
      <button type="submit" disabled={saving} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? 'Creating note…' : 'Create note & view link'}</button>
    </form>}

    {error && <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}<button onClick={() => { setError(''); void load(); }} className="font-semibold underline">Refresh list</button></div>}
    {activeCreated && <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="break-words font-medium">{activeCreated.kind === 'note' ? 'Note created' : 'File uploaded'}: {activeCreated.filename}</p>
      <div className="mt-2 flex flex-wrap gap-4">
        <a href={activeCreated.viewUrl || activeCreated.downloadUrl} target={activeCreated.viewUrl ? '_blank' : undefined} rel="noopener noreferrer" className="font-semibold underline">{activeCreated.kind === 'note' ? 'View note' : 'Download file'}</a>
        <button onClick={() => void copyLink(activeCreated)} className="font-semibold underline">{copied === activeCreated.id ? 'Link copied!' : 'Copy link'}</button>
        <span>Available for 24 hours.</span>
      </div>
    </div>}

    <div className="mb-4 mt-9 flex items-center justify-between gap-4">
      <h2 className="text-lg font-semibold text-gray-900">Public files & notes <span className="ml-1 text-sm font-normal text-gray-500">{visible.length}</span></h2>
      <button onClick={() => void load()} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Refresh</button>
    </div>
    <p className="mb-4 text-xs leading-5 text-gray-500">Each entry shows the uploader’s IP suffix, country code, and SHA-256 hash.</p>
    {loading ? <p role="status" className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Loading public files…</p>
      : !visible.length ? <div className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center">
        <p className="font-medium text-gray-900">Nothing shared yet</p><p className="mt-2 text-sm text-gray-500">Upload a file or create a note to start sharing.</p>
      </div> : <ul aria-label="Anonymous files and notes" className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
        {visible.map(file => <li key={file.id} className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="max-w-full break-words font-semibold text-gray-900">{file.filename}</span>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600" aria-label={`IP suffix ${file.maskedIp}`}>IP {file.maskedIp}</span>
                <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700" aria-label={`Country ${file.countryCode || 'Unknown'}`}>{file.countryCode || 'Unknown'}</span>
              </div>
              <p className="mt-2 text-xs text-gray-500">{file.kind === 'note' ? 'Note' : 'File'} · {sizeLabel(file.size)} · <time dateTime={file.expiresAt} title={`Expires ${new Date(file.expiresAt).toLocaleString()}`}>{timeLeft(file.expiresAt, now)}</time></p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm font-medium text-indigo-700">
              {file.viewUrl && <a href={file.viewUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">View note</a>}
              <a href={file.downloadUrl} className="hover:underline">Download</a>
              <button onClick={() => void copyLink(file)} className="hover:underline">{copied === file.id ? 'Link copied!' : 'Copy link'}</button>
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500"><span className="mr-2 font-semibold">SHA-256</span><code className="break-all font-mono text-gray-600">{file.sha256}</code></div>
        </li>)}
      </ul>}
  </section>;
}
