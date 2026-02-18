'use client';

import { useState, useEffect, FormEvent, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface DocRecord {
  id: string;
  title: string;
  source_url: string | null;
  mime_type: string;
  status: 'pending' | 'ingesting' | 'ingested' | 'error';
  error_msg: string | null;
  ingested_at: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-800',
  ingesting: 'bg-blue-100 text-blue-800',
  ingested:  'bg-green-100 text-green-800',
  error:     'bg-red-100 text-red-800',
};

export default function AdminClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  // Upload form state
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  // Per-doc ingestion state
  const [ingestingIds, setIngestingIds] = useState<Set<string>>(new Set());
  const [ingestErrors, setIngestErrors] = useState<Record<string, string>>({});

  const fetchDocs = async () => {
    setLoadingDocs(true);
    try {
      const res = await fetch('/api/admin/documents');
      const data = await res.json();
      setDocs(data.documents ?? []);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => { fetchDocs(); }, []);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!uploadFile) { setUploadError('Please select a file'); return; }
    if (!uploadTitle.trim()) { setUploadError('Please enter a title'); return; }

    setUploading(true);
    setUploadError('');
    setUploadSuccess('');

    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('title', uploadTitle.trim());
      if (uploadUrl.trim()) formData.append('sourceUrl', uploadUrl.trim());

      const res = await fetch('/api/admin/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error ?? 'Upload failed');
        return;
      }

      setUploadSuccess(`Uploaded! Document ID: ${data.documentId}`);
      setUploadTitle('');
      setUploadUrl('');
      setUploadFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await fetchDocs();
    } finally {
      setUploading(false);
    }
  }

  async function handleIngest(docId: string) {
    setIngestingIds((prev) => new Set(prev).add(docId));
    setIngestErrors((prev) => { const n = { ...prev }; delete n[docId]; return n; });

    try {
      const res = await fetch(`/api/admin/ingest/${docId}`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setIngestErrors((prev) => ({ ...prev, [docId]: data.error ?? 'Ingestion failed' }));
      }
    } finally {
      setIngestingIds((prev) => { const n = new Set(prev); n.delete(docId); return n; });
      await fetchDocs();
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm('Delete this document and all its chunks?')) return;
    await fetch(`/api/admin/documents?id=${docId}`, { method: 'DELETE' });
    await fetchDocs();
  }

  async function handleLogout() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    router.push('/admin/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-fbk-700 text-white px-6 py-4 flex items-center justify-between shadow">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <span className="font-semibold text-lg">FBK Chatbot Admin</span>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-white/80 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Upload section */}
        <section className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Document</h2>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="FBK Membership Guide"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-fbk-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Source URL (optional)
                </label>
                <input
                  type="url"
                  value={uploadUrl}
                  onChange={(e) => setUploadUrl(e.target.value)}
                  placeholder="https://fbk.org/membership"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-fbk-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                File <span className="text-red-500">*</span>{' '}
                <span className="text-gray-400 font-normal">(PDF, TXT, MD)</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-fbk-50 file:text-fbk-700 file:font-medium hover:file:bg-fbk-100 cursor-pointer"
              />
            </div>

            {uploadError && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{uploadError}</p>
            )}
            {uploadSuccess && (
              <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">{uploadSuccess}</p>
            )}

            <button
              type="submit"
              disabled={uploading}
              className="bg-fbk-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-fbk-700 disabled:opacity-60 transition-colors"
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </form>
        </section>

        {/* Documents list */}
        <section className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Documents</h2>
            <button
              onClick={fetchDocs}
              className="text-sm text-fbk-600 hover:text-fbk-700 font-medium"
            >
              Refresh
            </button>
          </div>

          {loadingDocs ? (
            <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>
          ) : docs.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              No documents yet. Upload one above.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {docs.map((doc) => (
                <div key={doc.id} className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{doc.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {doc.source_url ? (
                        <a href={doc.source_url} target="_blank" rel="noopener" className="text-fbk-600 hover:underline">
                          {doc.source_url}
                        </a>
                      ) : (
                        <span>No source URL</span>
                      )}
                      {' · '}
                      {doc.mime_type}
                      {' · '}
                      {new Date(doc.created_at).toLocaleDateString()}
                    </p>
                    {doc.error_msg && (
                      <p className="text-xs text-red-600 mt-1">{doc.error_msg}</p>
                    )}
                    {ingestErrors[doc.id] && (
                      <p className="text-xs text-red-600 mt-1">{ingestErrors[doc.id]}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[doc.status] ?? ''}`}>
                      {doc.status}
                    </span>

                    <button
                      onClick={() => handleIngest(doc.id)}
                      disabled={ingestingIds.has(doc.id)}
                      className="text-xs px-3 py-1.5 bg-fbk-50 text-fbk-700 rounded-lg hover:bg-fbk-100 disabled:opacity-50 font-medium transition-colors"
                    >
                      {ingestingIds.has(doc.id) ? 'Processing…' : 'Ingest'}
                    </button>

                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
