import { convert, ConversionError } from '../../src/core/index.js';
import type { ConversionOptions } from '../../src/core/types.js';
self.addEventListener(
  'message',
  (event: MessageEvent<{ id: number; text: string; options: ConversionOptions }>) => {
    const { id, text, options } = event.data;
    try {
      self.postMessage({ id, result: convert(text, options) });
    } catch (error) {
      self.postMessage({
        id,
        error: error instanceof ConversionError ? error.message : 'Unable to convert this text.',
      });
    }
  },
);
