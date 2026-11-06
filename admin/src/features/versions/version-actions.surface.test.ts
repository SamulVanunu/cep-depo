import { describe, expect, it } from 'vitest';

import * as actions from './version-actions';

/**
 * The published action surface is the security boundary: every export of a
 * `'use server'` module is reachable as a server action, so a leftover helper
 * export is a leftover endpoint. Only the replacement publication and the
 * withdrawal transition may be exposed.
 */
describe('version action surface', () => {
  it('exports only the replacement publication and withdrawal actions', () => {
    expect(Object.keys(actions).sort()).toEqual([
      'publishVersionReplacingPreviousAction',
      'withdrawVersionAction',
    ]);
  });
});
