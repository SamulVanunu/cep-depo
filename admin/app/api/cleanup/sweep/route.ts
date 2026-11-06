import { handleCleanupSweep } from '../../../../src/features/uploads/cleanup-http';
import { defaultCleanupHandlerDependencies } from '../../../../src/features/uploads/cleanup-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleCleanupSweep(request, await defaultCleanupHandlerDependencies());
}

export async function POST(request: Request) {
  return GET(request);
}
