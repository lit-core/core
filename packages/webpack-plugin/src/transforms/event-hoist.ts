import { transformEventHoist } from '@lit-core/event-hoist';
import type { EventHoistOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';

export const LIT_EVENT_HOIST_FAST_CHECK = /html\s*`[\s\S]*?@[a-zA-Z]/;

export function transformEventHoistPlugin(code: string, id: string, options: EventHoistOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_EVENT_HOIST_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = transformEventHoist(code, {
      sourcemap,
      filename: cleanId,
      events: options.events,
    });

    if (result.hoistedEventsCount === 0) {
      return null;
    }

    return {
      code: result.code,
      map: result.map ? JSON.parse(result.map) : null,
    };
  } catch (_err) {
    return null;
  }
}
