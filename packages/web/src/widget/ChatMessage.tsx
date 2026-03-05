import React, { useState } from 'react';
import { FeedbackModal } from './FeedbackModal';

export interface Source {
  title: string;
  url: string;
  snippet: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  feedback?: 'up' | 'down';
}

interface ChatMessageProps {
  message: Message;
  sessionId: string;
  apiBase: string;
  onFeedback: (msgId: string, rating: 'up' | 'down') => void;
}

/** Very small markdown renderer – handles bold, italic, links, lists */
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];

  lines.forEach((line, li) => {
    if (line.startsWith('- ') || line.startsWith('* ')) {
      nodes.push(<li key={li}>{inlineMarkdown(line.slice(2))}</li>);
    } else if (/^\d+\.\s/.test(line)) {
      nodes.push(<li key={li}>{inlineMarkdown(line.replace(/^\d+\.\s/, ''))}</li>);
    } else if (line.trim() === '') {
      nodes.push(<br key={li} />);
    } else {
      nodes.push(<p key={li}>{inlineMarkdown(line)}</p>);
    }
  });

  return <>{nodes}</>;
}

function inlineMarkdown(text: string): React.ReactNode {
  // Links: [label](url)
  const parts = text.split(/(\[.*?\]\(.*?\)|`[^`]+`|\*\*.*?\*\*|_.*?_)/g);
  return parts.map((part, i) => {
    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) {
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer">{linkMatch[1]}</a>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export function ChatMessage({ message, sessionId, apiBase, onFeedback }: ChatMessageProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const isUser = message.role === 'user';
  const hasSources = (message.sources?.length ?? 0) > 0;

  function handleThumbUp() {
    if (message.feedback) return;
    onFeedback(message.id, 'up');
    fetch(`${apiBase}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, messageId: message.id, rating: 'up' }),
    }).catch(() => {});
  }

  function handleThumbDown() {
    if (message.feedback) return;
    onFeedback(message.id, 'down');
    setShowModal(true);
  }

  return (
    <div className={`fbk-msg fbk-msg--${message.role}`}>
      <div className="fbk-bubble">
        {isUser ? message.content : renderMarkdown(message.content)}
      </div>

      {!isUser && (
        <>
          {hasSources && (
            <div className="fbk-sources">
              <button
                className={`fbk-sources-toggle${sourcesOpen ? ' fbk-sources-toggle--open' : ''}`}
                onClick={() => setSourcesOpen((v) => !v)}
              >
                <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
                {sourcesOpen ? 'Hide' : 'View'} {message.sources!.length} source{message.sources!.length > 1 ? 's' : ''}
              </button>
              {sourcesOpen && (
                <div className="fbk-sources-list">
                  {message.sources!.map((src, i) => (
                    <div key={i} className="fbk-source-item">
                      <div className="fbk-source-title">
                        <a href={src.url} target="_blank" rel="noopener noreferrer">{src.title}</a>
                      </div>
                      <div className="fbk-source-snippet">{src.snippet}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="fbk-feedback">
            <button
              className={`fbk-feedback-btn${message.feedback === 'up' ? ' fbk-feedback-btn--active-up' : ''}`}
              title="Helpful"
              onClick={handleThumbUp}
            >
              {/* thumbs up */}
              <svg viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            </button>
            <button
              className={`fbk-feedback-btn${message.feedback === 'down' ? ' fbk-feedback-btn--active-down' : ''}`}
              title="Not helpful"
              onClick={handleThumbDown}
            >
              {/* thumbs down */}
              <svg viewBox="0 0 24 24"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
            </button>
            {message.feedback && (
              <span className="fbk-feedback-thanks">
                {message.feedback === 'up' ? 'Thanks!' : 'Sorry about that.'}
              </span>
            )}
          </div>
        </>
      )}

      {showModal && (
        <FeedbackModal
          messageId={message.id}
          sessionId={sessionId}
          apiBase={apiBase}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
