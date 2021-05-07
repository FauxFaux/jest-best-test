import { join } from 'path';
import { readFile } from 'fs/promises';
import glob from 'glob';
import pMap from 'p-map';
import { brotliDecompressSync } from 'zlib';
import type { Hash } from './reporter';

interface CovDataElement {
  result: { scriptId: string, url: string, functions: unknown[] };
  code: Hash;
  originalCode: Hash;
}

async function main() {

  const bySource: {[sourcePath: string]: {[testName: string]: CovDataElement }} = {};

  const cwd = process.argv[2];
  await pMap(glob.sync('**/*.covdata.br', { cwd }), async (covDataPath) => {
    const suiteName = covDataPath.replace(/\.covdata\.br$/, '');
    const elements: CovDataElement[] = JSON.parse(brotliDecompressSync(await readFile(join(cwd, covDataPath))).toString('utf-8'));
    for (const el of elements) {
      const sourcePath = el.result.url;
      if (!(sourcePath in bySource)) {
        bySource[sourcePath] = {};
      }

      bySource[sourcePath][suiteName] = el;
    }
  }, { concurrency: 8 });

  console.log(bySource);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
})
