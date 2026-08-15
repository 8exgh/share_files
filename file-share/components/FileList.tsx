'use client';

import { useEffect, useState } from 'react';
import { UploadedFile } from '@/types';

interface FileListProps {
  files: UploadedFile[];
  onRefresh: () => void;
}

export default function FileList({ files, onRefresh }: FileListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!previewFile) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewFile(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewFile]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const copyToClipboard = async (file: UploadedFile) => {
    const url = `${window.location.origin}${file.downloadUrl}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(file.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const openPreview = async (file: UploadedFile) => {
    setPreviewFile(file);
    setPreviewContent('');
    setPreviewError(null);
    setPreviewLoading(true);

    try {
      const response = await fetch(file.downloadUrl);
      if (!response.ok) throw new Error('Unable to load this file.');
      setPreviewContent(await response.text());
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Unable to load this file.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDelete = async (file: UploadedFile) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${file.filename}"? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(file.id);

    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        // Refresh the file list
        onRefresh();
      } else {
        alert(`Failed to delete file: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Failed to delete:', err);
      alert('Failed to delete file. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleAutoDelete = async (file: UploadedFile) => {
    setTogglingId(file.id);
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoDelete: !file.autoDelete }),
      });
      const data = await response.json();
      if (data.success) {
        onRefresh();
      } else {
        alert(`Failed to update: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Failed to toggle auto-delete:', err);
      alert('Failed to update auto-delete setting.');
    } finally {
      setTogglingId(null);
    }
  };

  if (files.length === 0) {
    return (
      <div className="text-center py-12">
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">No files</h3>
        <p className="mt-1 text-sm text-gray-500">Get started by uploading a file.</p>
      </div>
    );
  }

  const copyButton = (file: UploadedFile) => (
    <button
      onClick={() => copyToClipboard(file)}
      className="text-indigo-600 hover:text-indigo-900 inline-flex items-center"
    >
      {copiedId === file.id ? (
        <>
          <svg className="h-5 w-5 mr-1 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy Link
        </>
      )}
    </button>
  );

  const deleteButton = (file: UploadedFile) => (
    <button
      onClick={() => handleDelete(file)}
      disabled={deletingId === file.id}
      className="text-red-600 hover:text-red-900 inline-flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {deletingId === file.id ? (
        <>
          <svg className="animate-spin h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Deleting...
        </>
      ) : (
        <>
          <svg className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Delete
        </>
      )}
    </button>
  );

  const previewButton = (file: UploadedFile) => file.filename.toLowerCase().endsWith('.txt') && (
    <button
      onClick={() => openPreview(file)}
      className="text-indigo-600 hover:text-indigo-900 inline-flex items-center"
    >
      <svg className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0c0 4.418-4.03 8-9 8s-9-3.582-9-8 4.03-8 9-8 9 3.582 9 8zm-9 3a3 3 0 100-6 3 3 0 000 6z" />
      </svg>
      View
    </button>
  );

  const autoDeleteToggle = (file: UploadedFile) => (
    <button
      onClick={() => handleToggleAutoDelete(file)}
      disabled={togglingId === file.id}
      className={`inline-flex items-center text-xs font-medium px-2 py-1 rounded-full disabled:opacity-50 disabled:cursor-not-allowed ${
        file.autoDelete
          ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
          : 'bg-green-100 text-green-800 hover:bg-green-200'
      }`}
      title={file.autoDelete ? 'Click to pin (prevent auto-delete)' : 'Click to enable auto-delete'}
    >
      {togglingId === file.id ? (
        <svg className="animate-spin h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : file.autoDelete ? (
        <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : (
        <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
      )}
      {file.autoDelete ? 'Auto-delete' : 'Pinned'}
    </button>
  );

  return (
    <>
      {/* Mobile: card layout */}
      <div className="md:hidden space-y-3">
        {files.map((file) => (
          <div key={file.id} className="bg-white shadow ring-1 ring-black ring-opacity-5 rounded-lg p-4">
            <div className="text-sm font-medium text-gray-900 break-all">{file.filename}</div>
            <div className="mt-1 flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>{formatFileSize(file.size)}</span>
              <span>&middot;</span>
              <span>{formatDate(file.uploadDate)}</span>
              {autoDeleteToggle(file)}
            </div>
            <div className="mt-3 flex items-center space-x-4">
              {previewButton(file)}
              {copyButton(file)}
              {deleteButton(file)}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table layout */}
      <div className="hidden md:block overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Filename
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Size
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Upload Date
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {files.map((file) => (
              <tr key={file.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {file.filename}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatFileSize(file.size)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDate(file.uploadDate)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {autoDeleteToggle(file)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex items-center space-x-4">
                    {previewButton(file)}
                    {copyButton(file)}
                    {deleteButton(file)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="text-preview-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewFile(null);
          }}
        >
          <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h2 id="text-preview-title" className="min-w-0 truncate pr-4 text-base font-semibold text-gray-900">
                {previewFile.filename}
              </h2>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                aria-label="Close preview"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 bg-gray-50 p-4">
              {previewLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading preview...</div>
              ) : previewError ? (
                <div className="flex h-full items-center justify-center text-sm text-red-600">{previewError}</div>
              ) : (
                <pre className="h-full w-full overflow-auto rounded border border-gray-200 bg-white p-4 font-mono text-sm text-gray-900 whitespace-pre">
                  {previewContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
