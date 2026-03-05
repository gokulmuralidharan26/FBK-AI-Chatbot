/**
 * Widget entry point – bundled by esbuild into public/widget.js
 *
 * Usage on any website:
 *   <script src="https://your-domain/widget.js" data-fbk-chatbot defer></script>
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatWidget } from './ChatWidget';
// esbuild loads this as a plain string (loader: { '.css': 'text' })
// @ts-ignore
import styles from './widget.css';

function getApiBase(): string {
  // Find the script tag that loaded this bundle
  const scripts = Array.from(document.querySelectorAll('script[data-fbk-chatbot]'));
  if (scripts.length > 0) {
    const src = (scripts[scripts.length - 1] as HTMLScriptElement).src;
    if (src) {
      try { return new URL(src).origin; } catch {}
    }
  }
  // Fallback: same origin (useful in dev)
  return window.location.origin;
}

function mount() {
  // Prevent double-mounting
  if (document.getElementById('fbk-chatbot-host')) return;

  const apiBase = getApiBase();

  // Host element
  const host = document.createElement('div');
  host.id = 'fbk-chatbot-host';
  // Ensure the host itself doesn't affect page layout
  host.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);

  // Shadow DOM for style isolation
  const shadow = host.attachShadow({ mode: 'open' });

  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.textContent = styles as unknown as string;
  shadow.appendChild(styleEl);

  // App container
  const app = document.createElement('div');
  app.style.pointerEvents = 'auto';
  shadow.appendChild(app);

  createRoot(app).render(
    React.createElement(ChatWidget, { apiBase })
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
