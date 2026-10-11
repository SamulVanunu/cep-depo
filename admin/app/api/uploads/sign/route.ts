import { NextResponse } from 'next/server';

import { getServerEnv } from '../../../../src/lib/env';
import { toActionError } from '../../../../src/server/errors/action-error';
import { assertSameOrigin } from '../../../../src/server/http/assert-same-origin';
import { createUploadIntentAction } from '../../../../src/features/uploads/upload-actions';
import { resumableUploadEndpoint } from '../../../../src/features/uploads/upload-endpoint';

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    assertSameOrigin(request, env.siteUrl);
    const result = await createUploadIntentAction(await request.json());
    if (!result.ok) return NextResponse.json(result, { status: result.error.code === 'VALIDATION' ? 400 : 403 });
    return NextResponse.json({
      ...result,
      data: {
        ...result.data,
        endpoint: resumableUploadEndpoint(env.supabaseUrl),
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toActionError(error) }, { status: 403 });
  }
}
