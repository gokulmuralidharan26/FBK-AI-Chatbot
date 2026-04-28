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

function clearSessionId(): string {
  const id = crypto.randomUUID();
  try { localStorage.setItem(SESSION_KEY, id); } catch {}
  return id;
}

/** Download chat messages as a plain-text file */
function downloadChat(messages: Message[]) {
  const lines: string[] = [
    'FBK Assistant — Chat Transcript',
    `Saved: ${new Date().toLocaleString()}`,
    '─'.repeat(40),
    '',
  ];
  for (const m of messages) {
    lines.push(m.role === 'user' ? 'You:' : 'FBK Assistant:');
    lines.push(m.content);
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fbk-chat-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ChatWidget({ apiBase }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // 'idle' | 'confirm' — controls the end-chat confirmation overlay
  const [endChatState, setEndChatState] = useState<'idle' | 'confirm'>('idle');

  const sessionIdRef = useRef<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyLoadedRef = useRef(false);

  // ── Init session + load history on first open ─────────────────────────────
  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId();
    const t = setTimeout(() => setShowTooltip(false), 5000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Focus input whenever panel opens
    setTimeout(() => inputRef.current?.focus(), 100);

    // Load history once per session
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    const sid = sessionIdRef.current;
    if (!sid) return;

    setLoadingHistory(true);
    fetch(`${apiBase}/api/chat/history?sessionId=${sid}&limit=50`)
      .then((r) => r.json())
      .then((data) => {
        const loaded: Message[] = (data.messages ?? []).map((m: {
          id: string; role: string; content: string; sources?: Source[];
        }) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          sources: m.sources ?? [],
        }));
        if (loaded.length > 0) setMessages(loaded);
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [open, apiBase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsgId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: userMsgId, role: 'user', content: text }]);
    setInput('');
    setStreaming(true);

    const asstMsgId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: asstMsgId, role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: sessionIdRef.current }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

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
                prev.map((m) => m.id === asstMsgId ? { ...m, content: m.content + event.token! } : m)
              );
            } else if (event.type === 'done') {
              if (event.messageId) finalMessageId = event.messageId;
              if (event.sessionId) {
                sessionIdRef.current = event.sessionId;
                try { localStorage.setItem(SESSION_KEY, event.sessionId); } catch {}
              }
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== asstMsgId) return m;
                  const clean = m.content
                    .replace(/<!--SOURCES_JSON[\s\S]*?SOURCES_JSON-->/g, '')
                    .replace(/\n{1,2}\*{0,2}Sources?\*{0,2}\s*\n*/gi, '')
                    .trimEnd();
                  return { ...m, id: finalMessageId, content: clean, sources: event.sources ?? [] };
                })
              );
            } else if (event.type === 'error') {
              setMessages((prev) =>
                prev.map((m) => m.id === asstMsgId ? { ...m, content: 'Sorry, something went wrong. Please try again.' } : m)
              );
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) => m.id === asstMsgId ? { ...m, content: 'Sorry, I ran into an error. Please try again.' } : m)
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Re-focus input so the user can type immediately
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, streaming, apiBase]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleFeedback(msgId: string, rating: 'up' | 'down') {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, feedback: rating } : m)));
  }

  // ── End chat ──────────────────────────────────────────────────────────────
  function handleEndChat(saveFirst: boolean) {
    if (saveFirst && messages.length > 0) downloadChat(messages);
    // Start a fresh session
    sessionIdRef.current = clearSessionId();
    historyLoadedRef.current = false;
    setMessages([]);
    setEndChatState('idle');
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="fbk-root">
      {/* Chat panel */}
      <div
        className={`fbk-panel${open ? ' fbk-panel--open' : ' fbk-panel--closed'}`}
        role="dialog"
        aria-label="FBK Assistant"
        style={{ position: 'relative' }}
      >
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

          {/* Header action buttons */}
          <div className="fbk-header-actions">
            {/* Save chat */}
            {hasMessages && (
              <button
                className="fbk-header-btn"
                onClick={() => downloadChat(messages)}
                aria-label="Save chat transcript"
                title="Save chat"
              >
                {/* Download icon */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
            )}

            {/* End / clear chat */}
            {hasMessages && (
              <button
                className="fbk-header-btn fbk-header-btn--danger"
                onClick={() => setEndChatState('confirm')}
                aria-label="End chat"
                title="End chat"
              >
                {/* Trash icon */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                </svg>
              </button>
            )}

            {/* Minimize */}
            <button className="fbk-close-btn" onClick={() => setOpen(false)} aria-label="Minimize chat">
              <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* End-chat confirmation overlay */}
        {endChatState === 'confirm' && (
          <div className="fbk-confirm-overlay">
            <div className="fbk-confirm-box">
              <p className="fbk-confirm-title">End this chat?</p>
              <p className="fbk-confirm-sub">All messages will be cleared. This cannot be undone.</p>
              <div className="fbk-confirm-actions">
                <button
                  className="fbk-confirm-btn fbk-confirm-btn--save"
                  onClick={() => handleEndChat(true)}
                >
                  Save &amp; End
                </button>
                <button
                  className="fbk-confirm-btn fbk-confirm-btn--clear"
                  onClick={() => handleEndChat(false)}
                >
                  End without saving
                </button>
                <button
                  className="fbk-confirm-btn fbk-confirm-btn--cancel"
                  onClick={() => setEndChatState('idle')}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="fbk-messages">
          {loadingHistory && (
            <div className="fbk-history-loading">Loading previous messages…</div>
          )}

          {!loadingHistory && messages.length === 0 && (
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
