type LogSink = (record: Readonly<Record<string, unknown>>) => void;

type LogInput = Readonly<{
  correlationId: string;
  operation: string;
  actorId?: string;
  targetId?: string;
  targetType?: string;
  durationMs?: number;
  workerId?: string;
  counters?: Readonly<Record<string, number>>;
  error?: unknown;
  [key: string]: unknown;
}>;

// Fixed allowlist: a counter object is operational data, not a place to smuggle
// paths, job ids or error text into the log stream.
const COUNTER_KEYS = [
  'claimed',
  'completed',
  'skippedReferenced',
  'skippedOwnership',
  'quarantined',
  'failed',
  'leaseLost',
  'scanned',
  'enqueued',
] as const;

const WORKER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function safeCounters(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object') return null;

  const source = value as Record<string, unknown>;
  const picked: Record<string, number> = {};
  for (const key of COUNTER_KEYS) {
    const candidate = source[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      picked[key] = candidate;
    }
  }

  return Object.keys(picked).length > 0 ? picked : null;
}

function safeRecord(level: 'info' | 'error', input: LogInput) {
  const counters = safeCounters(input.counters);

  return {
    level,
    correlationId: input.correlationId,
    operation: input.operation,
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
    ...(input.targetType ? { targetType: input.targetType } : {}),
    ...(typeof input.durationMs === 'number' ? { durationMs: input.durationMs } : {}),
    ...(typeof input.workerId === 'string' && WORKER_ID_PATTERN.test(input.workerId)
      ? { workerId: input.workerId }
      : {}),
    ...(counters ? { counters } : {}),
    ...(input.error ? {
      errorClass: input.error instanceof Error ? input.error.name : 'UnknownError',
    } : {}),
  };
}

export function createLogger(sink: LogSink = record => console.info(JSON.stringify(record))) {
  return {
    info(input: LogInput) { sink(safeRecord('info', input)); },
    error(input: LogInput) { sink(safeRecord('error', input)); },
  };
}

export const logger = createLogger();
