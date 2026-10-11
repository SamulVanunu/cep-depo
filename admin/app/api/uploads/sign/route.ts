import { NextResponse } from 'next/server';

import { getServerEnv } from '../../../../src/lib/env';
import { toActionError } from '../../../../src/server/errors/action-error';
import { assertSameOrigin } from '../../../../src/server/http/assert-same-origin';
import { createUploadIntentAction } from '../../../../src/features/uploads/upload-actions';

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    assertSameOrigin(request, env.siteUrl);
    const result = await createUploadIntentAction(await request.json());
    if (!result.ok) return NextResponse.json(result, { status: result.error.code === 'VALIDATION' ? 400 : 403 });
    const project = new URL(env.supabaseUrl).hostname.split('.')[0];
    return NextResponse.json({
      ...result,
      data: {
        ...result.data,
        endpoint: `https://${project}.storage.supabase.co/storage/v1/upload/resumable/sign`,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toActionError(error) }, { status: 403 });
  }
}
