# FBK Chatbot

A production-ready AI chatbot for [fbk.org](https://fbk.org) — embeddable on any website via a single `<script>` tag. Built with Next.js 14, Supabase + pgvector, and OpenAI.

## Architecture

```
fbk-chatbot/
├── packages/
│   ├── web/               # Next.js 14 app (API + Admin + Widget bundle)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── api/chat/          ← SSE streaming chat endpoint
│   │   │   │   ├── api/feedback/      ← Thumbs up/down logging
│   │   │   │   ├── api/admin/         ← Protected admin API
│   │   │   │   └── admin/             ← Admin dashboard (password protected)
│   │   │   ├── lib/
│   │   │   │   ├── rag.ts             ← Retrieval-Augmented Generation
│   │   │   │   ├── ingest.ts          ← Shared ingestion pipeline
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
- An [OpenAI](https://platform.openai.com) API key

---

## Step-by-Step Setup

### 1. Clone & install

```bash
git clone https://github.com/your-org/fbk-chatbot.git
cd fbk-chatbot
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

This creates all tables, the pgvector index, and the `match_document_chunks` RPC function.

### 4. Create the Storage bucket

In the Supabase dashboard → **Storage** → **New bucket**:
- Name: `docs`
- Public: **off** (private)

Then in the SQL Editor run:

```sql
-- Allow the service role to read/write the docs bucket
create policy "service role full access"
on storage.objects for all
using (auth.role() = 'service_role');
```

### 5. Set environment variables

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role secret |
| `OPENAI_API_KEY` | platform.openai.com → API Keys |
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

1. Visit `/admin` and sign in
2. Click **Upload** → select a PDF, TXT, or MD file
3. Enter a title and (optionally) a source URL
4. Click **Ingest** next to the document

### Via the CLI (batch / automation)

```bash
# From the repo root
npx tsx packages/ingest/ingest.ts \
  --file ./docs/membership-guide.pdf \
  --title "Membership Guide" \
  --url "https://fbk.org/membership"
```

The CLI reads `.env` from the current directory. Supported formats: `.pdf`, `.txt`, `.md`.

---

## Building for Production

```bash
# Build widget bundle + Next.js app
npm run build

# Start
npm start
```

The widget bundle is automatically built as part of `npm run build` and placed at `public/widget.js`.

---

## Deploy to Vercel

1. Push the repo to GitHub
2. In Vercel → **New Project** → import the repo
3. Set **Root Directory** to `packages/web`
4. Add all environment variables from your `.env`
5. Deploy

> **Note:** Set `NEXT_PUBLIC_APP_URL` to your Vercel deployment URL after the first deploy.

---

## Embed in Squarespace (or any website)

Add this snippet to your Squarespace site via **Settings → Advanced → Code Injection → Footer**:

```html
<script
  src="https://YOUR_VERCEL_DOMAIN/widget.js"
  data-fbk-chatbot
  defer>
</script>
```

Replace `YOUR_VERCEL_DOMAIN` with your actual Vercel URL (e.g. `fbk-chatbot.vercel.app`).

The widget will appear as a floating "Ask FBK" button in the bottom-right corner.

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

**Sources object:**
```json
{
  "title": "FBK Programs Guide",
  "url": "https://fbk.org/programs",
  "snippet": "FBK offers three core programs..."
}
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
| Ingest | Chunk + embed + upsert a document |
| Delete | Remove a document and its chunks |

---

## Safety & Guardrails

- The bot **refuses** requests for private member data
- **No hallucinated links** — only URLs from ingested sources or the [configured allowlist](packages/web/src/lib/rag.ts)
- All responses are generated with `temperature: 0.3` for consistency
- Conversation history (last 6 turns) is included for context
- FAQ fast-path handles common questions without calling the embedding API

---

## Environment Variables Reference

```env
NEXT_PUBLIC_SUPABASE_URL=       # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Supabase anon key (public)
SUPABASE_SERVICE_ROLE_KEY=      # Supabase service role key (secret, server-only)
OPENAI_API_KEY=                 # OpenAI API key
ADMIN_PASSWORD=                 # Shared secret for /admin
NEXT_PUBLIC_APP_URL=            # Your app URL (used by homepage embed snippet)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Widget | React 18, esbuild (Shadow DOM bundle) |
| API | Next.js Route Handlers, Server-Sent Events |
| AI | OpenAI `gpt-4o-mini` + `text-embedding-3-small` |
| Database | Supabase Postgres + pgvector |
| Storage | Supabase Storage |
| Deployment | Vercel |
