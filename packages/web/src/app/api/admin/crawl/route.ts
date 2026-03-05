import { NextRequest } from 'next/server';
import { crawlSite } from '@/lib/crawler';

export const runtime = 'nodejs';
export const maxDuration = 300;

const CORS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const startUrl: string = body.startUrl ?? 'https://fbk.org';

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const progress of crawlSite(startUrl)) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(progress)}\n\n`)
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Crawl failed';
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: CORS });
}
