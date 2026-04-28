import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { matchFaq } from '@/lib/faq';
import { retrieveChunks, buildRagStream, parseSourcesFromReply } from '@/lib/rag';
import { supabase, type Source } from '@/lib/supabase';
import { isAlumniQuery, parseAlumniQuery, searchAlumni, formatAlumniResults } from '@/lib/alumni';
import { isWebSearchEnabled, webSearch, type TavilyResult } from '@/lib/tavily';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userMessage: string = (body.message ?? '').trim();
    let sessionId: string = body.sessionId ?? '';

    if (!userMessage) {
      return Response.json({ error: 'message is required' }, { status: 400, headers: CORS });
    }

    // ── Session management ────────────────────────────────────────────────────
    if (!sessionId) {
      sessionId = uuidv4();
      await supabase.from('chat_sessions').insert({ id: sessionId });
    } else {
      // Update last_seen (best-effort, don't block stream)
      supabase
        .from('chat_sessions')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', sessionId)
        .then(() => {});
    }

    // ── Save user message ─────────────────────────────────────────────────────
    const userMsgId = uuidv4();
    await supabase.from('chat_messages').insert({
      id: userMsgId,
      session_id: sessionId,
      role: 'user',
      content: userMessage,
    });

    // ── FAQ fast-path ─────────────────────────────────────────────────────────
    const faqAnswer = matchFaq(userMessage);
    if (faqAnswer) {
      const assistantMsgId = uuidv4();
      await supabase.from('chat_messages').insert({
        id: assistantMsgId,
        session_id: sessionId,
        role: 'assistant',
        content: faqAnswer,
        sources: [],
      });

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          // Stream the FAQ answer token by token for visual consistency
          const words = faqAnswer.split(' ');
          words.forEach((word, i) => {
            const token = i === 0 ? word : ' ' + word;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'token', token })}\n\n`)
            );
          });
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'done', messageId: assistantMsgId, sessionId, sources: [] })}\n\n`
            )
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }

    // ── Alumni networking query ───────────────────────────────────────────────
    if (isAlumniQuery(userMessage)) {
      const alumniQuery = parseAlumniQuery(userMessage);
      const alumni = await searchAlumni(alumniQuery, 25);
      const alumniContext = formatAlumniResults(alumni, alumniQuery);

      // Build a prompt specifically for alumni networking
      const alumniSystemPrompt = `You are FBK Assistant helping with alumni networking for Florida Blue Key.

Use ONLY the alumni data provided below to answer. 
- List matching alumni clearly with their name, company/role, and contact links.
- If the user asks for people in a specific role (e.g. "product management"), check names whose company or role/notes suggest that field — and mention it may not be exhaustive if the database has incomplete data for some members.
- Suggest a brief, warm outreach message they can send to a specific alumnus if asked.
- NEVER invent alumni or contact info not in the data.

ALUMNI DATA:
${alumniContext}`;

      const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      const { data: histRows } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(6);
      if (histRows) history.push(...[...histRows].reverse().map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content })));

      const { openai: gemini, CHAT_MODEL } = await import('@/lib/openai');
      const openaiStream = await gemini.chat.completions.create({
        model: CHAT_MODEL,
        stream: true,
        temperature: 0.3,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: alumniSystemPrompt },
          ...history,
          { role: 'user', content: userMessage },
        ],
      });

      const encoder = new TextEncoder();
      let fullText = '';
      const assistantMsgId = uuidv4();
      const alumniSources: Source[] = alumni.slice(0, 5).map((a) => ({
        title: a.full_name,
        url: a.facebook_url ?? a.linkedin_url ?? 'https://fbk.org',
        snippet: [a.company, a.role, a.industry, a.city].filter(Boolean).join(' · '),
      }));

      const sseStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of openaiStream) {
              const token = chunk.choices[0]?.delta?.content ?? '';
              if (token) {
                fullText += token;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', token })}\n\n`));
              }
            }
            await supabase.from('chat_messages').insert({ id: assistantMsgId, session_id: sessionId, role: 'assistant', content: fullText.trim(), sources: alumniSources as unknown as Source[] });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', messageId: assistantMsgId, sessionId, sources: alumniSources })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Stream error';
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(sseStream, {
        headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }

    // ── RAG pipeline ──────────────────────────────────────────────────────────
    const chunks = await retrieveChunks(userMessage, 10);

    // ── Web search (Tavily) — augments RAG context when enabled ──────────────
    let tavilyResults: TavilyResult[] = [];
    try {
      const searchEnabled = await isWebSearchEnabled();
      if (searchEnabled && process.env.TAVILY_API_KEY) {
        const { sources } = await webSearch(userMessage, 5);
        tavilyResults = sources;
        console.log(`Tavily: found ${sources.length} results for "${userMessage}"`);
      }
    } catch (err) {
      console.warn('Tavily search failed (non-fatal):', (err as Error).message);
    }

    // Fetch recent history for context
    const { data: historyRows } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(10);

    const history = (historyRows ?? [])
      .reverse()
      .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));

    const { stream: openaiStream, sources: ragSources } = await buildRagStream(
      userMessage,
      history,
      chunks,
      tavilyResults
    );

    // ── SSE streaming response ────────────────────────────────────────────────
    const encoder = new TextEncoder();
    let fullText = '';
    const assistantMsgId = uuidv4();

    const sseStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of openaiStream) {
            const token = chunk.choices[0]?.delta?.content ?? '';
            if (token) {
              fullText += token;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'token', token })}\n\n`)
              );
            }
          }

          // Parse the hidden sources block from the reply
          const { cleanText, sources } = parseSourcesFromReply(fullText, ragSources);

          // Persist assistant message
          await supabase.from('chat_messages').insert({
            id: assistantMsgId,
            session_id: sessionId,
            role: 'assistant',
            content: cleanText,
            sources: sources as unknown as Source[],
          });

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'done', messageId: assistantMsgId, sessionId, sources })}\n\n`
            )
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stream error';
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(sseStream, {
      headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    console.error('Chat route error:', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
}
