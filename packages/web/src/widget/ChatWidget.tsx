import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage, type Message, type Source } from './ChatMessage';

interface ChatWidgetProps {
  apiBase: string;
}

const SESSION_KEY = 'fbk_chatbot_session_id';

function getOrCreateSessionId(): string {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function ChatWidget({ apiBase }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);

  const sessionIdRef = useRef<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId();
    // Hide tooltip after 5s
    const t = setTimeout(() => setShowTooltip(false), 5000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsgId = crypto.randomUUID();
    const userMsg: Message = { id: userMsgId, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);

    const asstMsgId = crypto.randomUUID();
    // Add a placeholder assistant message that we'll stream into
    setMessages((prev) => [...prev, { id: asstMsgId, role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: sessionIdRef.current,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalMessageId = asstMsgId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;

          try {
            const event = JSON.parse(raw) as {
              type: 'token' | 'done' | 'error';
              token?: string;
              messageId?: string;
              sessionId?: string;
              sources?: Source[];
              error?: string;
            };

            if (event.type === 'token' && event.token) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstMsgId
                    ? { ...m, content: m.content + event.token! }
                    : m
                )
              );
            } else if (event.type === 'done') {
              if (event.messageId) finalMessageId = event.messageId;
              if (event.sessionId) {
                sessionIdRef.current = event.sessionId;
                try { localStorage.setItem(SESSION_KEY, event.sessionId); } catch {}
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstMsgId
                    ? { ...m, id: finalMessageId, sources: event.sources ?? [] }
                    : m
                )
              );
            } else if (event.type === 'error') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstMsgId
                    ? { ...m, content: `Sorry, something went wrong. Please try again.` }
                    : m
                )
              );
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstMsgId
              ? { ...m, content: 'Sorry, I ran into an error. Please try again.' }
              : m
          )
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, apiBase]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleFeedback(msgId: string, rating: 'up' | 'down') {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, feedback: rating } : m))
    );
  }

  return (
    <div className="fbk-root">
      {/* Chat panel */}
      <div className={`fbk-panel${open ? ' fbk-panel--open' : ' fbk-panel--closed'}`}
           role="dialog" aria-label="FBK Assistant" style={{ position: 'relative' }}>

        {/* Header */}
        <div className="fbk-header">
          <div className="fbk-header-icon">
            <svg viewBox="0 0 24 24">
              <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <div className="fbk-header-text">
            <div className="fbk-header-title">FBK Assistant</div>
            <div className="fbk-header-sub">Ask me anything about FBK</div>
          </div>
          <button className="fbk-close-btn" onClick={() => setOpen(false)} aria-label="Close chat">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Messages */}
        <div className="fbk-messages">
          {messages.length === 0 && (
            <div className="fbk-welcome">
              <div className="fbk-welcome-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h3>Hi! I'm the FBK Assistant</h3>
              <p>Ask me about FBK's programs, services, events, or how to get involved.</p>
            </div>
          )}

          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              sessionId={sessionIdRef.current}
              apiBase={apiBase}
              onFeedback={handleFeedback}
            />
          ))}

          {streaming && messages[messages.length - 1]?.content === '' && (
            <div className="fbk-typing">
              <div className="fbk-dot" />
              <div className="fbk-dot" />
              <div className="fbk-dot" />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="fbk-input-area">
          <textarea
            ref={inputRef}
            className="fbk-input"
            placeholder="Ask a question…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={streaming}
          />
          <button
            className="fbk-send-btn"
            onClick={sendMessage}
            disabled={streaming || !input.trim()}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>

        <div className="fbk-footer">
          Powered by <a href="https://fbk.org" target="_blank" rel="noopener">FBK</a>
        </div>
      </div>

      {/* Toggle button */}
      <div style={{ position: 'relative' }}>
        {showTooltip && !open && (
          <div className="fbk-btn-label">Ask FBK</div>
        )}
        <button
          className="fbk-btn"
          onClick={() => { setOpen((v) => !v); setShowTooltip(false); }}
          aria-label={open ? 'Close chat' : 'Open FBK Assistant'}
        >
          {open ? (
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
