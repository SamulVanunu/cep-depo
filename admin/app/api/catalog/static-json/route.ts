import { NextResponse } from 'next/server';

import { buildStaticCatalogForAdmin } from '../../../../src/features/catalog/static-json/dal';
import {
  publishStaticCatalog,
  StaticCatalogPublishError,
} from '../../../../src/features/catalog/static-json/github';
import { getServerEnv } from '../../../../src/lib/env';
import { requireAdmin } from '../../../../src/server/auth/require-admin';
import { toActionError, type ActionError, type ActionErrorCode } from '../../../../src/server/errors/action-error';
import { assertSameOrigin } from '../../../../src/server/http/assert-same-origin';

const statusByCode: Readonly<Record<ActionErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  READ_ONLY: 403,
  VALIDATION: 400,
  CONFLICT: 409,
  NOT_FOUND: 404,
  FEATURE_DISABLED: 400,
  TEMPORARY: 503,
  RETIRED_ASSET: 409,
  STALE_JOB: 409,
  REFERENCED: 409,
  STORAGE_UNKNOWN: 503,
  MANUAL_REVIEW: 409,
  INTERNAL: 500,
};

function errorResponse(code: ActionErrorCode, message?: string) {
  const error = toActionError(new Error(message ?? code));
  const payload: ActionError = message ? { ...error, code, message } : { ...error, code };
  return NextResponse.json({ ok: false, error: payload }, { status: statusByCode[code] });
}

export async function GET() {
  try {
    const identity = await requireAdmin();
    const bundle = await buildStaticCatalogForAdmin(identity);
    return NextResponse.json({
      ok: true,
      data: {
        generatedAt: bundle.generatedAt,
        appCount: bundle.appCount,
        categoryCount: bundle.categoryCount,
        skipped: bundle.skipped,
        files: bundle.files,
      },
    });
  } catch (error) {
    const action = toActionError(error);
    return NextResponse.json({ ok: false, error: action }, { status: statusByCode[action.code] });
  }
}

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    assertSameOrigin(request, env.siteUrl);
    const identity = await requireAdmin(undefined, { mutation: true });

    if (!env.catalogJsonRepo || !env.catalogJsonToken) {
      return errorResponse(
        'FEATURE_DISABLED',
        'GitHub aktarımı yapılandırılmadı. CATALOG_JSON_REPO ve CATALOG_JSON_GITHUB_TOKEN tanımlanmalı.',
      );
    }

    const bundle = await buildStaticCatalogForAdmin(identity);
    const result = await publishStaticCatalog(bundle, {
      token: env.catalogJsonToken,
      repo: env.catalogJsonRepo,
      branch: env.catalogJsonBranch,
      path: env.catalogJsonPath,
    });

    return NextResponse.json({
      ok: true,
      data: {
        ...result,
        generatedAt: bundle.generatedAt,
        appCount: bundle.appCount,
        categoryCount: bundle.categoryCount,
        skipped: bundle.skipped,
      },
    });
  } catch (error) {
    if (error instanceof StaticCatalogPublishError) {
      const code: ActionErrorCode =
        error.status === 401 || error.status === 403
          ? 'FORBIDDEN'
          : error.status === 409 || error.status === 422
            ? 'CONFLICT'
            : error.status === 400 || error.status === 404
              ? 'VALIDATION'
              : 'TEMPORARY';
      return errorResponse(code, error.message);
    }
    const action = toActionError(error);
    return NextResponse.json({ ok: false, error: action }, { status: statusByCode[action.code] });
  }
}
