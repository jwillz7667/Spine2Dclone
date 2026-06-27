import {
  createDocument,
  makeIdFactory,
  newDocState,
  type Document,
  type DocumentEnvironment,
} from '@marionette/document-core';

// The composition root (command-history Section 7.2): the ONE place the renderer constructs the
// production clock and the concrete IdFactory and injects them into document-core. No code inside
// document-core reads performance.now; it receives `now` here. The renderer is a DOM context, so
// performance.now is legitimate at this seam (and only here).
export function createProductionEnvironment(): DocumentEnvironment {
  return {
    now: () => performance.now(),
    createIds: makeIdFactory,
  };
}

// A new, empty document at startup (no bones until the first CreateBone). WP-0.8 replaces/augments
// this with file load through the same environment.
export function createInitialDocument(): Document {
  return createDocument(newDocState('untitled'), createProductionEnvironment());
}
