type LogSink = (record: Readonly<Record<string, unknown>>) => void;

type LogInput = Readonly<{
  correlationId: string;
  operation: string;
  actorId?: string;
  targetId?: string;
  targetType?: string;
  durationMs?: number;
  error?: unknown;
  [key: string]: unknown;
}>;

function safeRecord(level: 'info' | 'error', input: LogInput) {
  return {
    level,
    correlationId: input.correlationId,
    operation: input.operation,
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
    ...(input.targetType ? { targetType: input.targetType } : {}),
    ...(typeof input.durationMs === 'number' ? { durationMs: input.durationMs } : {}),
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
