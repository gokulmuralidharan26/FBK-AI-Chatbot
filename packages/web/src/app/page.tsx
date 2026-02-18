export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-lg text-center space-y-6">
        <div className="w-16 h-16 bg-fbk-600 rounded-2xl mx-auto flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-fbk-700">FBK Assistant</h1>
        <p className="text-gray-600 text-lg">
          An AI-powered chatbot for <a href="https://fbk.org" className="text-fbk-600 hover:underline">fbk.org</a>.
          Embed it on any website with a single script tag.
        </p>

        <div className="bg-white rounded-xl shadow p-4 text-left">
          <p className="text-sm font-semibold text-gray-500 mb-2">Embed snippet</p>
          <pre className="text-xs text-gray-800 bg-gray-50 rounded p-3 overflow-x-auto">
            {`<script src="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.vercel.app'}/widget.js"\n  data-fbk-chatbot\n  defer>\n</script>`}
          </pre>
        </div>

        <a
          href="/admin"
          className="inline-block bg-fbk-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-fbk-700 transition-colors"
        >
          Admin Panel →
        </a>
      </div>
    </main>
  );
}
