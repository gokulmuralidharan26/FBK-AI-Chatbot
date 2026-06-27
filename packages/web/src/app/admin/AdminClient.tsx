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

  // ── Settings / Tavily state ───────────────────────────────────────────────
  const [tavilyEnabled, setTavilyEnabled] = useState(false);
  const [tavilyToggling, setTavilyToggling] = useState(false);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => setTavilyEnabled(d.settings?.tavily_enabled === 'true'))
      .catch(() => {});
  }, []);

  async function handleToggleTavily() {
    setTavilyToggling(true);
    const newVal = !tavilyEnabled;
    try {
      await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'tavily_enabled', value: String(newVal) }),
      });
      setTavilyEnabled(newVal);
    } finally {
      setTavilyToggling(false);
    }
  }

  // ── Alumni state ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'documents' | 'alumni' | 'settings'>('documents');
  const alumniCsvRef = useRef<HTMLInputElement>(null);
  const [alumniCity, setAlumniCity] = useState('');
  const [alumniFile, setAlumniFile] = useState<File | null>(null);
  const [alumniUploading, setAlumniUploading] = useState(false);
  const [alumniUploadResult, setAlumniUploadResult] = useState('');

  interface AlumniRow {
    id: string; full_name: string; city: string | null; state: string | null;
    company: string | null; role: string | null; industry: string | null;
    tapping_class: string | null; linkedin_url: string | null;
    facebook_url: string | null; enrichment_source: string | null;
  }

  const [alumniList, setAlumniList] = useState<AlumniRow[]>([]);
  const [alumniTotal, setAlumniTotal] = useState(0);
  const [alumniPage, setAlumniPage] = useState(0);
  const ALUMNI_PAGE_SIZE = 100;
  const [alumniFilter, setAlumniFilter] = useState({
    search: '', city: '', state: '', industry: '', company: '', tapping_class: '',
  });
  const [loadingAlumni, setLoadingAlumni] = useState(false);
  const [alumniExporting, setAlumniExporting] = useState(false);

  const buildAlumniParams = (
    overrides: Partial<typeof alumniFilter & { page: number }> = {}
  ) => {
    const f = { ...alumniFilter, ...overrides };
    const p = overrides.page ?? alumniPage;
    const params = new URLSearchParams();
    if (f.search)        params.set('search',        f.search);
    if (f.city)          params.set('city',           f.city);
    if (f.state)         params.set('state',          f.state);
    if (f.industry)      params.set('industry',       f.industry);
    if (f.company)       params.set('company',        f.company);
    if (f.tapping_class) params.set('tapping_class',  f.tapping_class);
    params.set('limit',  String(ALUMNI_PAGE_SIZE));
    params.set('offset', String(p * ALUMNI_PAGE_SIZE));
    return params;
  };

  const fetchAlumni = async (overrides: Partial<typeof alumniFilter & { page: number }> = {}) => {
    setLoadingAlumni(true);
    try {
      const res = await fetch(`/api/admin/alumni?${buildAlumniParams(overrides)}`);
      const data = await res.json();
      setAlumniList(data.alumni ?? []);
      setAlumniTotal(data.count ?? 0);
    } finally {
      setLoadingAlumni(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'alumni') fetchAlumni();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

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
    await fetchAlumni();
  }

  async function handleExportCSV() {
    setAlumniExporting(true);
    try {
      const params = buildAlumniParams();
      params.set('export', '1');
      // Use limit=5000 for full export
      params.set('limit', '5000');
      params.delete('offset');
      const res = await fetch(`/api/admin/alumni?${params}`, { method: 'POST' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fbk-alumni.csv';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setAlumniExporting(false);
    }
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
          {(['documents', 'alumni', 'settings'] as const).map((tab) => (
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
              {tab === 'alumni' ? '🤝 Alumni Network' : tab === 'settings' ? '⚙️ Settings' : '📄 Documents'}
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

            {/* Alumni Browser */}
            <section className="bg-white rounded-2xl shadow p-6">
              {/* Header row */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Alumni Database</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {loadingAlumni ? 'Loading…' : `${alumniTotal.toLocaleString()} total · showing ${alumniList.length}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportCSV}
                  disabled={alumniExporting}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {alumniExporting ? 'Exporting…' : 'Export CSV'}
                </button>
              </div>

              {/* Filter bar */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
                {[
                  { key: 'search',        placeholder: 'Search name…',   label: 'Name' },
                  { key: 'city',          placeholder: 'City…',          label: 'City' },
                  { key: 'state',         placeholder: 'State…',         label: 'State' },
                  { key: 'industry',      placeholder: 'Industry…',      label: 'Industry' },
                  { key: 'company',       placeholder: 'Company…',       label: 'Company' },
                  { key: 'tapping_class', placeholder: 'e.g. Fall 2022', label: 'Tapping Class' },
                ].map(({ key, placeholder }) => (
                  <input
                    key={key}
                    type="text"
                    placeholder={placeholder}
                    value={alumniFilter[key as keyof typeof alumniFilter]}
                    onChange={(e) => {
                      const updated = { ...alumniFilter, [key]: e.target.value };
                      setAlumniFilter(updated);
                      setAlumniPage(0);
                      fetchAlumni({ ...updated, page: 0 });
                    }}
                    className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-1 focus:ring-fbk-500 focus:outline-none"
                  />
                ))}
              </div>

              {/* Table */}
              {loadingAlumni ? (
                <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>
              ) : alumniList.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">
                  No alumni match these filters. Try uploading a CSV above or run the enrichment script.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-gray-500">
                          <th className="pb-2 pr-3 font-medium">Name</th>
                          <th className="pb-2 pr-3 font-medium">Tapping Class</th>
                          <th className="pb-2 pr-3 font-medium">Company · Role</th>
                          <th className="pb-2 pr-3 font-medium">Industry</th>
                          <th className="pb-2 pr-3 font-medium">Location</th>
                          <th className="pb-2 pr-3 font-medium">Links</th>
                          <th className="pb-2 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {alumniList.map((a) => (
                          <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="py-2 pr-3 font-medium text-gray-900 whitespace-nowrap">{a.full_name}</td>
                            <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                              {a.tapping_class ?? '—'}
                            </td>
                            <td className="py-2 pr-3 text-gray-600">
                              {a.company
                                ? <><span className="font-medium">{a.company}</span>{a.role ? ` · ${a.role}` : ''}</>
                                : a.role ?? '—'}
                            </td>
                            <td className="py-2 pr-3">
                              {a.industry ? (
                                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium whitespace-nowrap">{a.industry}</span>
                              ) : '—'}
                            </td>
                            <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                              {[a.city, a.state].filter(Boolean).join(', ') || '—'}
                            </td>
                            <td className="py-2 pr-3 flex items-center gap-2">
                              {a.linkedin_url && (
                                <a href={a.linkedin_url} target="_blank" rel="noreferrer"
                                  className="text-blue-600 hover:underline">LI</a>
                              )}
                              {a.facebook_url && (
                                <a href={a.facebook_url} target="_blank" rel="noreferrer"
                                  className="text-blue-600 hover:underline">FB</a>
                              )}
                              {!a.linkedin_url && !a.facebook_url && <span className="text-gray-300">—</span>}
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

                  {/* Pagination */}
                  {alumniTotal > ALUMNI_PAGE_SIZE && (
                    <div className="flex items-center justify-between mt-4 pt-3 border-t">
                      <span className="text-xs text-gray-400">
                        Page {alumniPage + 1} of {Math.ceil(alumniTotal / ALUMNI_PAGE_SIZE)}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={alumniPage === 0}
                          onClick={() => { const p = alumniPage - 1; setAlumniPage(p); fetchAlumni({ page: p }); }}
                          className="px-3 py-1 border border-gray-300 rounded text-xs disabled:opacity-40 hover:bg-gray-50"
                        >
                          ← Prev
                        </button>
                        <button
                          type="button"
                          disabled={(alumniPage + 1) * ALUMNI_PAGE_SIZE >= alumniTotal}
                          onClick={() => { const p = alumniPage + 1; setAlumniPage(p); fetchAlumni({ page: p }); }}
                          className="px-3 py-1 border border-gray-300 rounded text-xs disabled:opacity-40 hover:bg-gray-50"
                        >
                          Next →
                        </button>
                      </div>
                    </div>
                  )}
                </>
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

        {/* ── Settings Tab ──────────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="space-y-6">

            {/* Web Search (Tavily) */}
            <section className="bg-white rounded-2xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Web Search</h2>
              <p className="text-sm text-gray-500 mb-6">
                When enabled, the chatbot will search the web in real time for every query and
                include those results alongside its existing FBK knowledge base. Requires a
                <code className="bg-gray-100 px-1 rounded mx-1">TAVILY_API_KEY</code>
                environment variable to be set.
              </p>

              <button
                type="button"
                onClick={handleToggleTavily}
                disabled={tavilyToggling}
                className="w-full flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200 hover:bg-gray-100 transition-colors disabled:opacity-60 cursor-pointer text-left"
              >
                <div>
                  <p className="font-medium text-gray-900">Tavily Web Search</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {tavilyEnabled
                      ? 'Active — chatbot will search the web for every query'
                      : 'Inactive — chatbot uses only its FBK knowledge base'}
                  </p>
                </div>
                {/* Toggle pill */}
                <div
                  className={`relative shrink-0 ml-4 h-8 w-14 rounded-full transition-colors duration-200 ${
                    tavilyEnabled ? 'bg-fbk-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200 ${
                      tavilyEnabled ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </div>
              </button>

              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <strong>Note:</strong> Web search uses your Tavily quota (1,000 searches/month on
                the free plan). Every user message counts as one search when enabled. Disable it
                to conserve quota or keep the bot focused on FBK-specific knowledge.
              </div>
            </section>

          </div>
        )}

      </div>
    </div>
  );
}
