# FBK Chatbot

An AI-powered chatbot for [fbk.org](https://fbk.org) — embeddable on any website via a single `<script>` tag. Built with Next.js, Supabase + pgvector, Google Gemini (chat), and UF NaviGator Toolkit (embeddings).

## Architecture

```
fbk-chatbot/
├── packages/
│   ├── web/               # Next.js app (API + Admin + Widget bundle)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── api/chat/          ← SSE streaming chat endpoint
│   │   │   │   ├── api/feedback/      ← Thumbs up/down logging
│   │   │   │   ├── api/admin/         ← Protected admin API
│   │   │   │   └── admin/             ← Admin dashboard (password protected)
│   │   │   ├── lib/
│   │   │   │   ├── rag.ts             ← Retrieval-Augmented Generation
│   │   │   │   ├── ingest.ts          ← Document ingestion pipeline
│   │   │   │   ├── crawler.ts         ← Website crawler
│   │   │   │   ├── openai.ts          ← AI clients (Gemini + NaviGator)
│   │   │   │   └── faq.ts             ← FAQ fast-path
│   │   │   └── widget/                ← Embeddable chat widget source
│   │   ├── public/widget.js           ← Built widget bundle (output)
│   │   └── scripts/build-widget.ts   ← esbuild script
│   └── ingest/            # CLI ingestion script
└── supabase/migrations/   # SQL schema
```

---

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- A [UF NaviGator Toolkit](https://api.ai.it.ufl.edu/ui) API key (UF affiliates only) — used for embeddings
- A [Google Gemini](https://aistudio.google.com/apikey) API key — used for chat

---

## Step-by-Step Setup

### 1. Clone & install

```bash
git clone https://github.com/gokulmuralidharan26/FBK-AI-Chatbot.git
cd FBK-AI-Chatbot
npm install
```

### 2. Create a Supabase project

1. Go to [app.supabase.com](https://app.supabase.com) → **New project**
2. Note your **Project URL** and **API keys** (Settings → API)

### 3. Run the database migration

In the Supabase dashboard → **SQL Editor**, paste and run the contents of:

```
supabase/migrations/001_init.sql
```

This creates all tables, a pgvector index (768-dim for `nomic-embed-text-v1.5`), and the `match_document_chunks` RPC function.

### 4. Create the Storage bucket

In the Supabase dashboard → **Storage** → **New bucket**:
- Name: `docs`
- Public: **off** (private)

Then in the SQL Editor run:

```sql
create policy "service role full access"
on storage.objects for all
using (auth.role() = 'service_role');
```

### 5. Set environment variables

```bash
cp .env.example packages/web/.env.local
```

Edit `packages/web/.env.local`:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role secret |
| `NAVIGATOR_API_KEY` | [api.ai.it.ufl.edu/ui](https://api.ai.it.ufl.edu/ui) — needs `nomic-embed-text-v1.5` access |
| `NAVIGATOR_BASE_URL` | `https://api.ai.it.ufl.edu/v1` |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `CHAT_MODEL` | `gemini-2.0-flash` (or `gemini-1.5-pro` for more capability) |
| `ADMIN_PASSWORD` | Choose any strong password |
| `NEXT_PUBLIC_APP_URL` | Your Vercel URL (or `http://localhost:3000` for local) |

### 6. Run locally

```bash
npm run dev
```

- App: http://localhost:3000
- Admin: http://localhost:3000/admin

---

## Ingesting Documents

### Via the Admin Panel (recommended)

1. Visit `/admin` and sign in with your `ADMIN_PASSWORD`
2. **Upload** → select a PDF, TXT, or MD file, enter a title and optional source URL
3. Click **Ingest** next to the document to chunk, embed, and store it

### Crawl the Website

The admin panel has a **Crawl fbk.org** button that automatically fetches every public page on fbk.org, extracts the text, and ingests it. Re-crawling updates existing pages with fresh content.

### Via the CLI (batch / automation)

```bash
npx tsx packages/ingest/ingest.ts \
  --file ./docs/membership-guide.pdf \
  --title "Membership Guide" \
  --url "https://fbk.org/membership"
```

Supported formats: `.pdf`, `.txt`, `.md`.

---

## Building for Production

```bash
# Build widget bundle + Next.js app
npm run build

# Start
npm start
```

The widget bundle is automatically built as part of `npm run build` and placed at `public/widget.js`.

To rebuild the widget only (without a full Next.js build):

```bash
npm run build:widget --workspace=packages/web
```

---

## Deploy to Vercel

1. Push the repo to GitHub
2. In Vercel → **New Project** → import the repo
3. Set **Root Directory** to `packages/web`
4. Add all environment variables from your `.env.local`
5. Deploy

> **Note:** Set `NEXT_PUBLIC_APP_URL` to your Vercel deployment URL after the first deploy.

---

## Embed on Any Website

Add this snippet to your site (e.g. Squarespace → Settings → Advanced → Code Injection → Footer):

```html
<script
  src="https://YOUR_VERCEL_DOMAIN/widget.js"
  data-fbk-chatbot
  defer>
</script>
```

Replace `YOUR_VERCEL_DOMAIN` with your actual Vercel URL. The widget appears as a floating chat button in the bottom-right corner.

---

## API Reference

### `POST /api/chat`

Streams an AI response using Server-Sent Events.

**Request body:**
```json
{
  "message": "What programs does FBK offer?",
  "sessionId": "optional-uuid"
}
```

**SSE events:**
```
data: {"type":"token","token":"FBK "}
data: {"type":"token","token":"offers..."}
data: {"type":"done","messageId":"uuid","sessionId":"uuid","sources":[...]}
data: [DONE]
```

### `POST /api/feedback`

```json
{
  "sessionId": "uuid",
  "messageId": "uuid",
  "rating": "up" | "down",
  "category": "optional category",
  "comment": "optional comment"
}
```

---

## Admin Panel

Protected by a shared secret (`ADMIN_PASSWORD` env var).

| Feature | Description |
|---|---|
| Upload | Upload PDF/TXT/MD to Supabase Storage |
| Documents list | View all docs with ingestion status |
| Ingest | Chunk, embed, and upsert a document into the vector DB |
| Delete | Remove a document and all its chunks |
| Crawl Website | Auto-fetch and ingest all public pages from fbk.org |

---

## Safety & Guardrails

- The bot **refuses** requests for private member data
- **No hallucinated links** — only URLs from ingested sources or the [configured allowlist](packages/web/src/lib/rag.ts)
- All responses use `temperature: 0.3` for consistency
- Conversation history (last 6 turns) is included for context
- FAQ fast-path handles common questions without calling the embedding API
- If the embedding API is unavailable, chat falls back gracefully to Gemini's own knowledge

---

## Environment Variables Reference

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=       # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Supabase anon key (public)
SUPABASE_SERVICE_ROLE_KEY=      # Supabase service role key (secret, server-only)

# UF NaviGator Toolkit — embeddings only
NAVIGATOR_API_KEY=              # NaviGator API key (needs nomic-embed-text-v1.5 access)
NAVIGATOR_BASE_URL=             # https://api.ai.it.ufl.edu/v1

# Google Gemini — chat completions
GEMINI_API_KEY=                 # Google AI Studio API key
CHAT_MODEL=                     # gemini-2.0-flash (default)

# App
ADMIN_PASSWORD=                 # Shared secret for /admin
NEXT_PUBLIC_APP_URL=            # Your app URL (used by homepage embed snippet)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS |
| Widget | React, esbuild bundle |
| API | Next.js Route Handlers, Server-Sent Events |
| Chat AI | Google Gemini 2.0 Flash |
| Embeddings | UF NaviGator `nomic-embed-text-v1.5` (runs on HiPerGator) |
| Database | Supabase Postgres + pgvector |
| Storage | Supabase Storage |
| Deployment | Vercel |
