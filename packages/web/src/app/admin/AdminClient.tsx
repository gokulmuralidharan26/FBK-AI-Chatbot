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

  // Per-doc delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Crawl state
  const [crawling, setCrawling] = useState(false);
  const [crawlLog, setCrawlLog] = useState<Array<{ url: string; title?: string; status: string; message?: string }>>([]);
  const [crawlDone, setCrawlDone] = useState<number | null>(null);
  const crawlLogRef = useRef<HTMLDivElement>(null);

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
    await fetch(`/api/admin/documents?id=${docId}`, { method: 'DELETE' });
    setConfirmDeleteId(null);
    await fetchDocs();
  }

  async function handleCrawl() {
    setCrawling(true);
    setCrawlLog([]);
    setCrawlDone(null);

    const res = await fetch('/api/admin/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startUrl: 'https://fbk.org' }),
    });

    if (!res.body) { setCrawling(false); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'page') {
            setCrawlLog((prev) => [...prev, {
              url: event.url,
              title: event.title,
              status: event.status,
              message: event.message,
            }]);
            // Auto-scroll log
            setTimeout(() => {
              crawlLogRef.current?.scrollTo({ top: crawlLogRef.current.scrollHeight, behavior: 'smooth' });
            }, 50);
          } else if (event.type === 'done') {
            setCrawlDone(event.total ?? 0);
            await fetchDocs();
          }
        } catch { /* ignore malformed */ }
      }
    }

    setCrawling(false);
  }

  async function handleLogout() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    router.push('/admin/login');
  }

  // ── Alumni state ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'documents' | 'alumni'>('documents');
  const alumniCsvRef = useRef<HTMLInputElement>(null);
  const [alumniCity, setAlumniCity] = useState('');
  const [alumniFile, setAlumniFile] = useState<File | null>(null);
  const [alumniUploading, setAlumniUploading] = useState(false);
  const [alumniUploadResult, setAlumniUploadResult] = useState('');
  const [alumniList, setAlumniList] = useState<Array<{
    id: string; full_name: string; city: string | null; company: string | null;
    role: string | null; industry: string | null; facebook_url: string | null;
  }>>([]);
  const [alumniFilter, setAlumniFilter] = useState({ city: '', industry: '' });
  const [loadingAlumni, setLoadingAlumni] = useState(false);

  const fetchAlumni = async (city?: string, industry?: string) => {
    setLoadingAlumni(true);
    try {
      const params = new URLSearchParams();
      if (city) params.set('city', city);
      if (industry) params.set('industry', industry);
      const res = await fetch(`/api/admin/alumni?${params}`);
      const data = await res.json();
      setAlumniList(data.alumni ?? []);
    } finally {
      setLoadingAlumni(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'alumni') fetchAlumni();
  }, [activeTab]);

  async function handleAlumniUpload(e: FormEvent) {
    e.preventDefault();
    if (!alumniFile) { setAlumniUploadResult('Please select a CSV file'); return; }
    if (!alumniCity.trim()) { setAlumniUploadResult('Please enter the city for this group'); return; }

    setAlumniUploading(true);
    setAlumniUploadResult('');
    try {
      const fd = new FormData();
      fd.append('file', alumniFile);
      fd.append('city', alumniCity.trim());
      const res = await fetch('/api/admin/alumni', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setAlumniUploadResult(`Error: ${data.error}`);
      } else {
        setAlumniUploadResult(`✓ Imported ${data.inserted} alumni from ${alumniCity}`);
        setAlumniCity('');
        setAlumniFile(null);
        if (alumniCsvRef.current) alumniCsvRef.current.value = '';
        await fetchAlumni();
      }
    } finally {
      setAlumniUploading(false);
    }
  }

  async function handleDeleteAlumni(id: string, name: string) {
    if (!confirm(`Remove ${name} from the alumni database?`)) return;
    await fetch('/api/admin/alumni', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } });
    await fetchAlumni(alumniFilter.city, alumniFilter.industry);
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

        {/* Tab navigation */}
        <div className="flex gap-1 bg-white rounded-xl shadow p-1">
          {(['documents', 'alumni'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-fbk-700 text-white shadow'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab === 'alumni' ? '🤝 Alumni Network' : '📄 Documents'}
            </button>
          ))}
        </div>

        {activeTab === 'alumni' && (
          <div className="space-y-6">
            {/* Alumni CSV Upload */}
            <section className="bg-white rounded-2xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Import Alumni CSV</h2>
              <p className="text-sm text-gray-500 mb-4">
                Upload a CSV exported from a Facebook city group. Required columns: <code className="bg-gray-100 px-1 rounded">Facebook URL</code>, <code className="bg-gray-100 px-1 rounded">Full Name</code>, <code className="bg-gray-100 px-1 rounded">Company</code>. Optional: First Name, Last Name, Role, LinkedIn URL.
              </p>
              <form onSubmit={handleAlumniUpload} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      City / Location <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={alumniCity}
                      onChange={(e) => setAlumniCity(e.target.value)}
                      placeholder="New York, NY"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-fbk-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">This labels every person from this file with this city.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      CSV File <span className="text-red-500">*</span>
                    </label>
                    <input
                      ref={alumniCsvRef}
                      type="file"
                      accept=".csv"
                      onChange={(e) => setAlumniFile(e.target.files?.[0] ?? null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={alumniUploading}
                  className="px-5 py-2 bg-fbk-700 text-white rounded-lg text-sm font-medium hover:bg-fbk-800 disabled:opacity-50 transition-colors"
                >
                  {alumniUploading ? 'Importing…' : 'Import Alumni'}
                </button>
                {alumniUploadResult && (
                  <p className={`text-sm ${alumniUploadResult.startsWith('✓') ? 'text-green-700' : 'text-red-600'}`}>
                    {alumniUploadResult}
                  </p>
                )}
              </form>
            </section>

            {/* Alumni list */}
            <section className="bg-white rounded-2xl shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Alumni Database ({alumniList.length})</h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Filter by city…"
                    value={alumniFilter.city}
                    onChange={(e) => {
                      setAlumniFilter((f) => ({ ...f, city: e.target.value }));
                      fetchAlumni(e.target.value, alumniFilter.industry);
                    }}
                    className="px-2 py-1 border border-gray-300 rounded text-xs w-28"
                  />
                  <input
                    type="text"
                    placeholder="Filter by industry…"
                    value={alumniFilter.industry}
                    onChange={(e) => {
                      setAlumniFilter((f) => ({ ...f, industry: e.target.value }));
                      fetchAlumni(alumniFilter.city, e.target.value);
                    }}
                    className="px-2 py-1 border border-gray-300 rounded text-xs w-32"
                  />
                </div>
              </div>

              {loadingAlumni ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : alumniList.length === 0 ? (
                <p className="text-sm text-gray-400">No alumni yet. Upload a CSV above to get started.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 pr-3 font-medium">Name</th>
                        <th className="pb-2 pr-3 font-medium">Company</th>
                        <th className="pb-2 pr-3 font-medium">Industry</th>
                        <th className="pb-2 pr-3 font-medium">City</th>
                        <th className="pb-2 font-medium">Links</th>
                        <th className="pb-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {alumniList.map((a) => (
                        <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-2 pr-3 font-medium text-gray-900">{a.full_name}</td>
                          <td className="py-2 pr-3 text-gray-600">{a.company ?? '—'}</td>
                          <td className="py-2 pr-3">
                            {a.industry ? (
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium">{a.industry}</span>
                            ) : '—'}
                          </td>
                          <td className="py-2 pr-3 text-gray-500">{a.city ?? '—'}</td>
                          <td className="py-2 pr-3">
                            {a.facebook_url && (
                              <a href={a.facebook_url} target="_blank" rel="noreferrer"
                                className="text-blue-600 hover:underline mr-2">FB</a>
                            )}
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              onClick={() => handleDeleteAlumni(a.id, a.full_name)}
                              className="text-red-400 hover:text-red-600 text-[10px]"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'documents' && <div className="space-y-8">

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
                      type="button"
                      onClick={() => handleIngest(doc.id)}
                      disabled={ingestingIds.has(doc.id)}
                      className="text-xs px-3 py-1.5 bg-fbk-50 text-fbk-700 rounded-lg hover:bg-fbk-100 disabled:opacity-50 font-medium transition-colors"
                    >
                      {ingestingIds.has(doc.id) ? 'Processing…' : 'Ingest'}
                    </button>

                    {confirmDeleteId === doc.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-red-600 font-medium">Sure?</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(doc.id)}
                          className="text-xs px-2 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 font-medium transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(doc.id)}
                        className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium transition-colors cursor-pointer"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Crawl section */}
        <section className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Crawl Website</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Automatically fetch and ingest every page on fbk.org
              </p>
            </div>
            <button
              type="button"
              onClick={handleCrawl}
              disabled={crawling}
              className="px-4 py-2 bg-fbk-600 text-white text-sm font-medium rounded-lg hover:bg-fbk-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {crawling ? 'Crawling…' : 'Crawl fbk.org'}
            </button>
          </div>

          {crawlDone !== null && !crawling && (
            <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg mb-3">
              Done — {crawlDone} page{crawlDone !== 1 ? 's' : ''} ingested successfully.
            </p>
          )}

          {crawlLog.length > 0 && (
            <div
              ref={crawlLogRef}
              className="mt-3 bg-gray-50 rounded-lg border border-gray-200 p-3 h-56 overflow-y-auto font-mono text-xs space-y-0.5"
            >
              {crawlLog.map((entry, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className={
                    entry.status === 'ingested' ? 'text-green-600' :
                    entry.status === 'error'    ? 'text-red-500' :
                    'text-gray-400'
                  }>
                    {entry.status === 'ingested' ? '✓' : entry.status === 'error' ? '✗' : '–'}
                  </span>
                  <span className="truncate text-gray-700 flex-1" title={entry.url}>
                    {entry.title ?? entry.url}
                  </span>
                  {entry.message && (
                    <span className="text-gray-400 shrink-0">{entry.message}</span>
                  )}
                </div>
              ))}
              {crawling && (
                <div className="text-gray-400 animate-pulse">Crawling…</div>
              )}
            </div>
          )}
        </section>

        </div>} {/* end activeTab === 'documents' */}

      </div>
    </div>
  );
}
