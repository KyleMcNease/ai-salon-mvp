import type { NextRequest } from 'next/server';

import { getModelOptions, loadModelRegistry } from '@/config/modelRegistry';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const safeMode =
    searchParams.get('safeMode') === '1' ||
    searchParams.get('safe_mode') === '1' ||
    searchParams.get('safe') === 'true';
  const modality = searchParams.get('modality') ?? 'chat';

  const models = getModelOptions({ safeMode, modality });
  const registry = loadModelRegistry();

  return Response.json({
    models,
    providers: registry.providers,
    safeMode,
    modality,
    updatedAt: registry.updatedAt,
  });
}
