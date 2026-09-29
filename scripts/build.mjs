import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url)),
  out = resolve(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, 'app'), out, {
  recursive: true,
  filter: (source) => !source.endsWith('config.local.js'),
});
console.log('Static app built in dist/. Local Client ID configuration was excluded.');
