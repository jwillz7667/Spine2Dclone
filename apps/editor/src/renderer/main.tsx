// MUST be the first import: PixiJS v8 compiles shader/buffer accessors with `new Function`, which
// the strict production CSP (no unsafe-eval, LAW-abiding by design) forbids. This official module
// swaps in non-eval implementations; without it every Pixi Application.init throws in the packaged
// app and the viewport/preview panels never mount a canvas.
import 'pixi.js/unsafe-eval';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Renderer root element #root was not found.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
