import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { convert, ConversionError } from './core/index.js';

const BODY_LIMIT = 1024 * 1024;
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}
async function conversion(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } });
    return;
  }
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new ConversionError('UNSUPPORTED_MEDIA_TYPE', 'Use application/json.', 415);
  if (Number(request.headers['content-length'] ?? 0) > BODY_LIMIT) {
    request.resume();
    throw new ConversionError('BODY_TOO_LARGE', 'Request body exceeds 1 MiB.', 413);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT)
      throw new ConversionError('BODY_TOO_LARGE', 'Request body exceeds 1 MiB.', 413);
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new ConversionError('INVALID_JSON', 'Request must contain valid UTF-8 JSON.', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'text'))
    throw new ConversionError('INVALID_TEXT', 'Provide a text string.', 400, 'text');
  for (const key of Object.keys(body))
    if (!['text', 'options'].includes(key))
      throw new ConversionError('INVALID_OPTIONS', `Unknown request field: ${key}.`, 422, key);
  const payload = body as { text: string; options?: Parameters<typeof convert>[1] };
  json(response, 200, convert(payload.text, payload.options));
}
export function createAppServer(staticRoot = fileURLToPath(new URL('../dist', import.meta.url))) {
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path === '/v1/convert') {
        await conversion(request, response);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or HEAD.' } });
        return;
      }
      const root = resolve(staticRoot),
        target = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
      if (!target.startsWith(root + sep)) {
        json(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
        return;
      }
      // Only browser assets are public. The bundled server, library, declarations and maps are not.
      if (!(
        target === resolve(root, 'index.html') ||
        target.startsWith(resolve(root, 'assets') + sep) ||
        target === resolve(root, 'favicon.svg')
      )) {
        json(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
        return;
      }
      let file: Buffer;
      try {
        file = await readFile(target);
      } catch {
        json(response, 404, {
          error: { code: 'NOT_FOUND', message: 'Not found. Build the browser app first.' },
        });
        return;
      }
      const type: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
      };
      response.writeHead(200, {
        'Content-Type': (type[extname(target)] ?? 'application/octet-stream') + '; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : file);
    } catch (error) {
      if (error instanceof ConversionError)
        json(response, error.status, {
          error: {
            code: error.code,
            message: error.message,
            ...(error.field ? { field: error.field } : {}),
          },
        });
      else
        json(response, 500, {
          error: { code: 'INTERNAL_ERROR', message: 'Unable to complete the request.' },
        });
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000),
    host = process.env.HOST ?? '127.0.0.1';
  createAppServer().listen(port, host, () =>
    console.log(`UwU Speak: http://${host}:${port} (POST /v1/convert)`),
  );
}
