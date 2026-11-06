import { describe, expect, it, vi } from 'vitest';

import { createPublishOperationTracker } from './publish-operation-id';

// A10.36 S7.1 — the client owns the catalog operation id.
//
// The server action is stateless per invocation; an HTTP retry arrives as a new
// call. So the id has to be minted on the client, held for as long as one
// publish is in flight, and reused on every retry of that publish. Only a
// completed publish (or an explicit reset) may start a new operation, and a
// different review/version is a different publication with its own id.

const reviewOne = 'a3000000-0000-4000-8000-000000000001';
const reviewTwo = 'a3000000-0000-4000-8000-000000000002';

describe('createPublishOperationTracker', () => {
  it('reuses the same operation id for every retry of one review', () => {
    const createId = vi.fn(() => 'd8000000-0000-4000-8000-000000000001');
    const tracker = createPublishOperationTracker(createId);

    const first = tracker.start(reviewOne);
    const retry = tracker.start(reviewOne);
    const secondRetry = tracker.start(reviewOne);

    expect(first).toBe('d8000000-0000-4000-8000-000000000001');
    expect(retry).toBe(first);
    expect(secondRetry).toBe(first);
    expect(createId).toHaveBeenCalledOnce();
  });

  it('mints a new operation id for a different review instead of replaying the old payload', () => {
    let n = 0;
    const tracker = createPublishOperationTracker(
      () => `d8000000-0000-4000-8000-00000000000${++n}`,
    );

    const first = tracker.start(reviewOne);
    const second = tracker.start(reviewTwo);

    expect(second).not.toBe(first);
    expect(tracker.peek()).toBe(second);
  });

  it('mints a new operation id after a publish completes', () => {
    let n = 0;
    const tracker = createPublishOperationTracker(
      () => `d8000000-0000-4000-8000-00000000000${++n}`,
    );

    const first = tracker.start(reviewOne);
    tracker.finish();
    const next = tracker.start(reviewOne);

    expect(first).not.toBe(next);
    expect(tracker.peek()).toBe(next);
  });

  it('keeps the in-flight id when a publish fails so the retry can recover', () => {
    let n = 0;
    const tracker = createPublishOperationTracker(
      () => `d8000000-0000-4000-8000-00000000000${++n}`,
    );

    const first = tracker.start(reviewOne);

    // A failed publish does not call finish; the same id is presented again.
    expect(tracker.start(reviewOne)).toBe(first);
    expect(n).toBe(1);
  });
});
