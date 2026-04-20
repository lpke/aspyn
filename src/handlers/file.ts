import { readFile, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { register, type HandlerContext } from './registry.js';

const VALID_ENCODINGS = [
  'utf-8',
  'utf8',
  'ascii',
  'latin1',
  'base64',
  'hex',
  'utf16le',
] as const;

register({
  name: 'file',
  async run(_ctx: HandlerContext, input: unknown) {
    const { path: filePath, encoding = 'utf-8' } = input as {
      path: string;
      encoding?: string;
    };

    if (!(VALID_ENCODINGS as readonly string[]).includes(encoding)) {
      throw new Error(`file: unsupported encoding "${encoding}"`);
    }

    const resolved = isAbsolute(filePath) ? filePath : resolve(filePath);
    const content = await readFile(resolved, encoding as BufferEncoding);
    const stats = await stat(resolved);

    return {
      content,
      path: resolved,
      modifiedAt: stats.mtime.toISOString(),
    };
  },
});
