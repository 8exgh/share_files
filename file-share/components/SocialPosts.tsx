'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SocialPost } from '@/types';

type Platform = 'postedToTwitter' | 'postedToLinkedIn';
const platformNames: Record<Platform, string> = { postedToTwitter: 'Twitter', postedToLinkedIn: 'LinkedIn' };
const inputClass = 'mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100';

export default function SocialPosts({ maxFileSize }: { maxFileSize: number }) {
  const router = useRouter();
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [pendingStatus, setPendingStatus] = useState<Record<string, { platform: Platform; value: boolean }>>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [asset, setAsset] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [formError, setFormError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/social-posts', { cache: 'no-store' });
      const data = await response.json();
      if (response.status === 401) { router.push('/'); return; }
      if (!response.ok) throw new Error(data.message || 'Could not load social posts');
      setPosts(data.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load social posts'); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (adding) titleRef.current?.focus(); }, [adding]);
  useEffect(() => {
    if (!asset) { setPreview(''); return; }
    const url = URL.createObjectURL(asset); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [asset]);

  const closeForm = () => {
    setAdding(false); setTitle(''); setDescription(''); setAsset(null); setFormError('');
    formRef.current?.reset(); addButtonRef.current?.focus();
  };
  const addPost = async (event: FormEvent) => {
    event.preventDefault(); setFormError('');
    if (!title.trim() || !description.trim()) { setFormError('Add a title and description.'); return; }
    if (asset && asset.size > maxFileSize) { setFormError(`Choose an attachment under ${Math.round(maxFileSize / 1024 / 1024)} MB.`); return; }
    setSaving(true);
    const body = new FormData(); body.append('title', title); body.append('description', description);
    if (asset) body.append('file', asset);
    try {
      const response = await fetch('/api/social-posts', { method: 'POST', body });
      const data = await response.json();
      if (response.status === 401) { router.push('/'); return; }
      if (!response.ok) throw new Error(data.message || 'Could not add post');
      setPosts(current => [...current, data.data]);
      setNotice(`Added “${data.data.title}” to the queue.`); closeForm();
    } catch (err) { setFormError(err instanceof Error ? err.message : 'Could not add post'); }
    finally { setSaving(false); }
  };

  const markBusy = (id: string, value: boolean) => setBusy(current => {
    const next = new Set(current); if (value) next.add(id); else next.delete(id); return next;
  });
  const updateStatus = async (post: SocialPost, platform: Platform, value: boolean) => {
    markBusy(post.id, true); setError('');
    setPendingStatus(current => ({ ...current, [post.id]: { platform, value } }));
    try {
      const response = await fetch(`/api/social-posts/${post.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [platform]: value }),
      });
      const data = await response.json();
      if (response.status === 401) { router.push('/'); return; }
      if (!response.ok) throw new Error(data.message || 'Could not update posting status');
      setPosts(current => current.map(item => item.id === post.id ? data.data : item));
      setNotice(data.data.archived ? `Archived “${post.title}” — posted to both platforms.` : post.archived ? `“${post.title}” returned to the queue.` : `Updated ${platformNames[platform]} status for “${post.title}”.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update posting status'); }
    finally {
      markBusy(post.id, false);
      setPendingStatus(current => { const next = { ...current }; delete next[post.id]; return next; });
    }
  };
  const deletePost = async (post: SocialPost) => {
    if (!window.confirm(`Delete “${post.title}” and its attachment?`)) return;
    markBusy(post.id, true); setError('');
    try {
      const response = await fetch(`/api/social-posts/${post.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (response.status === 401) { router.push('/'); return; }
      if (!response.ok) throw new Error(data.message || 'Could not delete post');
      setPosts(current => current.filter(item => item.id !== post.id)); setNotice(`Deleted “${post.title}”.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete post'); }
    finally { markBusy(post.id, false); }
  };
  const copy = async (post: SocialPost) => {
    try { await navigator.clipboard.writeText(post.description); setCopied(post.id); }
    catch { setError('Could not copy the description. Select and copy the text directly.'); }
  };

  const archivedCount = posts.filter(post => post.archived).length;
  const visible = posts.filter(post => showArchived || !post.archived);
  const details = (post: SocialPost) => <>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="max-w-full break-words font-semibold text-gray-900">{post.title}</h3>
      {post.archived && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">Archived</span>}
    </div>
    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{post.description}</p>
    <p className="mt-3 text-xs text-gray-400">Added {new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
  </>;
  const media = (post: SocialPost) => post.asset ? <div className="w-40 max-w-full">
    {post.asset.kind === 'image'
      ? <img src={post.asset.url} alt={`Attachment for ${post.title}`} loading="lazy" className="h-24 w-full rounded-lg border border-gray-200 bg-gray-50 object-contain" />
      : <video src={post.asset.url} aria-label={`Video for ${post.title}`} controls preload="metadata" className="h-24 w-full rounded-lg bg-gray-950" />}
    <a href={`${post.asset.url}?download=1`} className="mt-2 inline-flex max-w-full items-center gap-1 text-xs font-medium text-indigo-700 hover:underline" title={post.asset.filename}>
      <span className="truncate">Download {post.asset.kind}</span><span aria-hidden="true">↓</span>
    </a>
  </div> : <span className="text-sm text-gray-400">No attachment</span>;
  const checkbox = (post: SocialPost, platform: Platform) => {
    const pending = pendingStatus[post.id];
    const savingStatus = pending?.platform === platform;
    const checked = savingStatus ? pending.value : post[platform];
    return <label className="inline-flex cursor-pointer items-center gap-2 py-2 text-sm text-gray-600">
    <input type="checkbox" checked={checked} disabled={busy.has(post.id)}
      onChange={event => void updateStatus(post, platform, event.target.checked)}
      aria-label={`Posted to ${platformNames[platform]} for ${post.title}`}
      className="h-5 w-5 cursor-pointer rounded border-gray-300 accent-indigo-600 disabled:cursor-wait disabled:opacity-50" />
    <span className={checked ? 'font-medium text-emerald-700' : ''}>{savingStatus ? 'Saving…' : checked ? 'Posted' : 'Not yet'}</span>
  </label>;
  };
  const actions = (post: SocialPost) => <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm md:flex-col md:items-start">
    <button onClick={() => void copy(post)} className="font-medium text-indigo-700 hover:underline">{copied === post.id ? 'Copied!' : 'Copy text'}</button>
    <button onClick={() => void deletePost(post)} disabled={busy.has(post.id)} className="text-gray-500 hover:text-red-600 disabled:opacity-50">Delete post</button>
  </div>;

  return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Post queue</h2>
        <p className="mt-1 text-sm text-gray-500">Mark each platform after publishing. Posts archive when both are checked.</p>
      </div>
      <button ref={addButtonRef} onClick={() => setAdding(true)} disabled={adding} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50">
        <span aria-hidden="true" className="text-lg leading-none">+</span> Add post
      </button>
    </div>

    {adding && <form ref={formRef} onSubmit={addPost} aria-label="Add social post" className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-lg font-semibold text-gray-900">New social post</h3>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div><label htmlFor="social-title" className="text-sm font-medium text-gray-700">Title</label>
            <input ref={titleRef} id="social-title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={160} disabled={saving} placeholder="Give this post a name" className={inputClass} /></div>
          <div><label htmlFor="social-description" className="text-sm font-medium text-gray-700">Description</label>
            <textarea id="social-description" value={description} onChange={event => setDescription(event.target.value)} required maxLength={10000} rows={6} disabled={saving} placeholder="Write the text you want to post…" className={`${inputClass} resize-y`} />
            <p className="mt-1 text-right text-xs text-gray-400">{description.length.toLocaleString()} / 10,000</p></div>
        </div>
        <div>
          <label htmlFor="social-asset" className="text-sm font-medium text-gray-700">Image or video <span className="font-normal text-gray-400">(optional)</span></label>
          <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <input ref={fileRef} id="social-asset" type="file" disabled={saving} accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mov"
              onChange={event => { setAsset(event.target.files?.[0] || null); setFormError(''); }}
              className="w-full text-xs text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:font-medium file:text-indigo-700 file:shadow-sm" />
            <p className="mt-3 text-xs leading-5 text-gray-500">JPEG, PNG, GIF, WebP, MP4, WebM or MOV. Up to {Math.round(maxFileSize / 1024 / 1024)} MB.</p>
            {asset && preview && <div className="mt-4">
              {asset.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(asset.name)
                ? <video src={preview} controls className="max-h-48 w-full rounded-md bg-black" />
                : <img src={preview} alt="Selected attachment preview" className="max-h-48 w-full rounded-md object-contain" />}
              <button type="button" disabled={saving} onClick={() => { setAsset(null); if (fileRef.current) fileRef.current.value = ''; }} className="mt-2 text-xs font-medium text-red-600 hover:underline">Remove attachment</button>
            </div>}
          </div>
        </div>
      </div>
      {formError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
      <div className="mt-5 flex items-center gap-3">
        <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Adding post…' : 'Add to queue'}</button>
        <button type="button" disabled={saving} onClick={closeForm} className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
      </div>
    </form>}

    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-gray-500">{posts.length - archivedCount} queued <span aria-hidden="true">·</span> {archivedCount} archived</p>
      <button type="button" aria-pressed={showArchived} onClick={() => setShowArchived(value => !value)}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${showArchived ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'}`}>
        {showArchived && <span aria-hidden="true">✓</span>} Show archived <span className="rounded-full bg-white px-1.5 text-xs text-gray-500">{archivedCount}</span>
      </button>
    </div>
    {notice && <p role="status" className="mb-4 text-sm text-emerald-700">{notice}</p>}
    {error && <div role="alert" className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}<button onClick={() => void load()} className="font-semibold underline">Reload</button></div>}
    {loading ? <div role="status" className="rounded-xl border border-gray-200 bg-white px-6 py-16 text-center text-sm text-gray-500">Loading posts…</div>
      : visible.length === 0 ? <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-2xl text-indigo-500" aria-hidden="true">≡</div>
        <h3 className="font-semibold text-gray-900">{posts.length ? 'Your queue is clear' : 'Your next post starts here'}</h3>
        <p className="mt-2 text-sm text-gray-500">{posts.length ? 'Show archived posts to review what you’ve published, or add a new post.' : 'Add a title, your post text, and an optional image or video.'}</p>
      </div> : <>
        <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm md:block">
          <table className="w-full table-fixed text-left">
            <caption className="sr-only">Social media post queue</caption>
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500">
              <tr><th scope="col" className="w-[36%] px-5 py-4">POST</th><th scope="col" className="w-[20%] px-4 py-4">ATTACHMENT</th><th scope="col" className="w-[16%] px-4 py-4">POSTED TO TWITTER</th><th scope="col" className="w-[17%] px-4 py-4">POSTED TO LINKEDIN</th><th scope="col" className="w-[11%] px-4 py-4"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">{visible.map(post => <tr key={post.id} className={post.archived ? 'bg-gray-50/60' : ''}>
              <td className="px-5 py-5 align-top">{details(post)}</td><td className="px-4 py-5 align-top">{media(post)}</td>
              <td className="px-4 py-5 align-top">{checkbox(post, 'postedToTwitter')}</td><td className="px-4 py-5 align-top">{checkbox(post, 'postedToLinkedIn')}</td><td className="px-4 py-5 align-top">{actions(post)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="space-y-4 md:hidden">{visible.map(post => <article key={post.id} aria-label={post.title} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          {details(post)}{post.asset && <div className="mt-4">{media(post)}</div>}
          <div className="my-4 grid grid-cols-2 gap-3 border-y border-gray-100 py-3">
            <div><p className="text-xs font-medium text-gray-500">Posted to Twitter</p>{checkbox(post, 'postedToTwitter')}</div>
            <div><p className="text-xs font-medium text-gray-500">Posted to LinkedIn</p>{checkbox(post, 'postedToLinkedIn')}</div>
          </div>{actions(post)}
        </article>)}</div>
      </>}
  </div>;
}
