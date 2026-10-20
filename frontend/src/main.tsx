import React from 'react';
import ReactDOM from 'react-dom/client';
import { createRouter, stringifySearchWith } from '@tanstack/react-router';
import './index.css';

// Import the generated route tree
import { routeTree } from './routeTree.gen';
import { App } from './App';
import { applyDisplayPreferences } from './lib/utils';

/**
 * Like JSON.parse, but numeric text stays a string. Route validators expect ids as strings,
 * and this lets URLs read `?periodId=20` instead of the JSON-quoted `?periodId=%2220%22`.
 * Older quoted links still parse to the same string.
 */
function parseSearchValue(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed === 'number') throw new Error('Keep numeric text as a string');
  return parsed;
}

/**
 * The router's default decoder converts numeric text to numbers before any custom parser runs,
 * so decode here directly and keep numeric text as written.
 */
function parseSearch(searchStr: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, raw] of new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr)) {
    let value: unknown = raw;
    try { value = parseSearchValue(raw); } catch { /* plain text or numeric id */ }
    const previous = result[key];
    result[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return result;
}

// Create a new router instance
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  parseSearch,
  stringifySearch: stringifySearchWith(JSON.stringify, parseSearchValue),
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Text size and reduced motion apply before the first paint, so nothing jumps after load.
applyDisplayPreferences();

// Render the app
const rootElement = document.getElementById('root')!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App router={router} />
    </React.StrictMode>
  );
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}
