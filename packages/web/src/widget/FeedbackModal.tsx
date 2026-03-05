import React, { useState } from 'react';

interface FeedbackModalProps {
  messageId: string;
  sessionId: string;
  apiBase: string;
  onClose: () => void;
}

const CATEGORIES = [
  'Inaccurate information',
  'Unhelpful response',
  'Missing information',
  'Inappropriate content',
  'Other',
];

export function FeedbackModal({ messageId, sessionId, apiBase, onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      await fetch(`${apiBase}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          messageId,
          rating: 'down',
          category: category || null,
          comment: comment.trim() || null,
        }),
      });
      setDone(true);
      setTimeout(onClose, 1200);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fbk-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fbk-modal">
        {done ? (
          <p style={{ textAlign: 'center', color: '#059669', fontWeight: 600, padding: '8px 0' }}>
            Thanks for your feedback!
          </p>
        ) : (
          <>
            <h4>What went wrong?</h4>
            <div className="fbk-modal-cats">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`fbk-cat-btn${category === cat ? ' fbk-cat-btn--selected' : ''}`}
                  onClick={() => setCategory(cat === category ? '' : cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            <textarea
              className="fbk-modal-textarea"
              placeholder="Optional: tell us more…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="fbk-modal-actions">
              <button className="fbk-modal-cancel" onClick={onClose}>Cancel</button>
              <button
                className="fbk-modal-submit"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? 'Sending…' : 'Submit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
