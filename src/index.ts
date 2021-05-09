import { inspect } from 'util';
import { join } from 'path';
import { readFile } from 'fs/promises';
import glob from 'glob';
import pMap from 'p-map';
import { brotliDecompressSync } from 'zlib';
import LineColumn from 'line-column';
import execa from 'execa';
import type { CovDataElement, CovDataFile } from './types';
import smurl from 'source-map-url';
import { SourceMapConsumer } from 'source-map-js';

async function loadFile(covDataPath: string): Promise<CovDataFile> {
  return JSON.parse(
    brotliDecompressSync(await readFile(covDataPath)).toString('utf-8'),
  );
}

/**  1-indexed (like text editors) */
interface SourcePosition {
  line: number;
  column: number;
}

interface SourceCoverage {
  start: SourcePosition;
  end: SourcePosition;
  count: number;
}

async function main() {
  const cwd = join(process.argv[2], 'coverage/.covdata');
  const covDatas = await pMap(
    glob.sync('**/*.covdata.br', { cwd }).sort(),
    async (covDataPath) => {
      const fullPath = join(cwd, covDataPath);
      try {
        return await loadFile(fullPath);
      } catch (err) {
        err.message += ` processing ${fullPath}`;
        throw err;
      }
    },
    { concurrency: 8 },
  );

  const mappers: {
    [codeHash: string]: (offset: number) => SourcePosition | null;
  } = {};

  async function mapperFor(el: Pick<CovDataElement, 'code' | 'wrapperLength'>) {
    if (el.code in mappers) {
      return mappers[el.code];
    }

    const codeResult = await execa('git', ['cat-file', 'blob', el.code], {
      encoding: 'utf-8',
      cwd,
    });
    const code = codeResult.stdout;
    const lineMapper = LineColumn(code);

    const toLine = (offset: number): SourcePosition | null => {
      const pos = lineMapper.fromIndex(offset - el.wrapperLength);
      // e.g. because it's outside of the reasonable area of code, such as the coverage info for the whole file (duh)
      if (!pos) return null;
      const consumer = new SourceMapConsumer(
        JSON.parse(parseDataURL(smurl.getFrom(code)!)?.body.toString('utf-8')!),
      );
      const mapped = consumer.originalPositionFor({
        line: pos.line,
        column: pos.col - 1,
      });
      return { line: mapped.line, column: mapped.column + 1 };
    };

    mappers[el.code] = toLine;
    return toLine;
  }

  const bySourceRange: {
    [sourcePath: string]: {
      [hypenatedRange: string]: {
        start: SourcePosition;
        end: SourcePosition;
        functionName: string;
        testCounts: { [testSuiteName: string]: number };
      };
    };
  } = {};

  for (const testSuite of covDatas) {
    console.log('for test suite', testSuite.testFilePath);
    for (const el of testSuite.sourceFilesCovered) {
      const good = el.result.functions.filter(
        // ignore non-block coverage, as it's poor quality
        ({ isBlockCoverage }) => isBlockCoverage,
      );
      if (!good.length) continue;

      const sourcePath = el.result.url;
      if (!(sourcePath in bySourceRange)) {
        bySourceRange[sourcePath] = {};
      }

      const thisSourceRange = bySourceRange[sourcePath];

      for (const func of good) {
        for (const range of func.ranges) {
          const hyphenated = `${range.startOffset}-${range.endOffset}`;
          if (!(hyphenated in thisSourceRange)) {
            const toLine = await mapperFor(el);
            const start = toLine(range.startOffset);
            const end = toLine(range.endOffset);
            if (!start || !end) continue;
            thisSourceRange[hyphenated] = {
              start,
              end,
              functionName: func.functionName,
              testCounts: {},
            };
          }
          thisSourceRange[hyphenated].testCounts[testSuite.testFilePath] =
            range.count;
        }
      }
    }
  }
  console.log(inspect(bySourceRange, false, 4, true));
}

const REGEX = /^data:(.+?);base64,(.*)/;

function parseDataURL(url: string) {
  const ma = url.match(REGEX);
  if (!ma) throw new Error(`unrecognised data url: ${url}`);
  const [, mime, base] = ma;
  if (!mime.startsWith('application/json'))
    throw new Error(`bad mime type in source map: ${mime}`);
  return { body: Buffer.from(base, 'base64') };
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
