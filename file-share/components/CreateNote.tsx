'use client';

import { useState } from 'react';
import { UploadedFile } from '@/types';

interface CreateNoteProps {
  onNoteCreated: (file: UploadedFile) => void;
}

export default function CreateNote({ onNoteCreated }: CreateNoteProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!content.trim()) {
      setError('Note content cannot be empty');
      return;
    }

    setError('');
    setSaving(true);

    try {
      const response = await fetch('/api/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          name: name.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        onNoteCreated(data.data);
        setContent('');
        setName('');
        setExpanded(false);
      } else {
        setError(data.message || 'Failed to create note');
      }
    } catch {
      setError('An error occurred while creating the note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
      >
        <svg
          className={`h-4 w-4 mr-2 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Create Note
      </button>

      {expanded && (
        <div className="mt-3 border border-gray-200 rounded-lg p-4 bg-white">
          <div className="mb-3">
            <label htmlFor="note-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="note-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Note_YYYY_mm_DD___HH_MM_SS"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div className="mb-3">
            <label htmlFor="note-content" className="block text-sm font-medium text-gray-700 mb-1">
              Content
            </label>
            <textarea
              id="note-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="Type or paste your note here..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-y"
            />
          </div>

          {error && (
            <div className="mb-3 rounded-md bg-red-50 p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={saving}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Create Note'}
          </button>
        </div>
      )}
    </div>
  );
}
