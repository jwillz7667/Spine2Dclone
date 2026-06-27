import { describe, expect, it } from 'vitest';
import * as documentCore from '../src';

// The structural half of LAW 2 (command-history Section 3.3, 9.1) is enforced at compile time: the
// Mutator brand is a unique symbol and createMutator / DocumentModelInternal are not exported, so UI
// or MCP code that imports the public barrel cannot obtain a write surface, and `as Mutator` cannot
// fabricate the brand. This test pins the runtime half of that guarantee: the privileged names never
// appear on the public surface, so a regression that accidentally exports them fails CI.
describe('LAW 2 structural surface', () => {
  it('does not export the privileged write surface from the public barrel', () => {
    const keys = Object.keys(documentCore);
    expect(keys).not.toContain('createMutator');
    expect(keys).not.toContain('DocumentModelInternal');
    expect(keys).not.toContain('Mutator'); // a type, erased at runtime; asserted for completeness
  });

  it('exports the read/command surface tools and the MCP server need', () => {
    const keys = Object.keys(documentCore);
    for (const expected of [
      'History',
      'createDocument',
      'loadDocument',
      'exportDocument',
      'commandRegistry',
      'CreateBoneCommand',
      'MoveBoneCommand',
    ]) {
      expect(keys).toContain(expected);
    }
  });
});
