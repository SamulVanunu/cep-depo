/**
 * A10.36 S7.1 — the client-side catalog operation identity.
 *
 * A catalog publication is identified by one `operationId` that must survive
 * every retry of *that* publication. The server action cannot hold it (each
 * HTTP retry is a fresh invocation), so the browser mints it and sends it as
 * an argument.
 *
 * The identity of a publication is the review it publishes, and the review is
 * identified by its version id: the sealed payload names that version's APK
 * release and is replayed verbatim on a retry. Reusing the id for a different
 * version would replay bytes that describe the wrong release — and after a
 * failed intent the producer answers every replay with CONFLICT, so the user
 * could never retry. Reusing it for the same version is exactly what makes a
 * lost response recoverable.
 *
 * The tracker is therefore keyed:
 *
 *   * `start(key)` returns the id of the publish currently in flight for that
 *     key, minting one only the first time. A retry — automatic or
 *     user-initiated — presents the same version and therefore the same id.
 *   * a different key (a new review/version) mints a new id, because it is a
 *     new publication even within the same wizard session.
 *   * `finish` ends the operation, so the next user publish gets a new id.
 *   * a failed publish never calls `finish`: the retry is still the same
 *     operation and must be able to recover it.
 */
export type PublishOperationTracker = Readonly<{
  /** The in-flight operation id, or null when no publish has started. */
  peek(): string | null;
  /** The id for this publish identity, minted on first use and reused on retry. */
  start(key: string): string;
  /** Ends the operation; the next publish starts a new one. */
  finish(): void;
}>;

export function createPublishOperationTracker(
  createId: () => string,
): PublishOperationTracker {
  let inFlight: Readonly<{ key: string; id: string }> | null = null;
  return {
    peek: () => inFlight?.id ?? null,
    start: (key: string) => {
      if (inFlight?.key !== key) {
        inFlight = { key, id: createId() };
      }
      return inFlight.id;
    },
    finish: () => {
      inFlight = null;
    },
  };
}
