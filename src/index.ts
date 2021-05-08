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
import parseDataURL from 'data-urls';
import { SourceMapConsumer } from 'source-map-js';

async function handle(
  covDataPath: string,
  bySource: { [p: string]: { [p: string]: CovDataElement } },
) {
  const body: CovDataFile = JSON.parse(
    brotliDecompressSync(await readFile(covDataPath)).toString('utf-8'),
  );
  const suiteName = body.testFilePath;
  for (const el of body.sourceFilesCovered) {
    const sourcePath = el.result.url;
    if (!(sourcePath in bySource)) {
      bySource[sourcePath] = {};
    }

    bySource[sourcePath][suiteName] = el;
  }
}

/**  1-indexed (like text editors) */
interface SourcePosition {
  line: number;
  column: number;
}

async function main() {
  const bySource: {
    [sourcePath: string]: { [testName: string]: CovDataElement };
  } = {};

  const cwd = join(process.argv[2], 'coverage/.covdata');
  await pMap(
    glob.sync('**/*.covdata.br', { cwd }),
    async (covDataPath) => {
      const fullPath = join(cwd, covDataPath);
      try {
        await handle(fullPath, bySource);
      } catch (err) {
        err.message += ` processing ${fullPath}`;
        throw err;
      }
    },
    { concurrency: 8 },
  );

  for (const [source, wat] of Object.entries(bySource)) {
    for (const [test, el] of Object.entries(wat)) {
      const good = el.result.functions.filter(
        ({ isBlockCoverage }) => isBlockCoverage,
      );
      if (!good.length) continue;
      const codeResult = await execa('git', ['cat-file', 'blob', el.code], {
        encoding: 'utf-8',
        cwd,
      });
      const code = codeResult.stdout;
      const lineMapper = LineColumn(code);
      const toLine = (offset: number): SourcePosition | null => {
        const pos = lineMapper.fromIndex(offset - el.wrapperLength);
        // e.g. because
        if (!pos) return null;
        const consumer = new SourceMapConsumer(
          JSON.parse(
            parseDataURL(smurl.getFrom(code)!)?.body.toString('utf-8')!,
          ),
        );
        const mapped = consumer.originalPositionFor({
          line: pos.line,
          column: pos.col - 1,
        });
        return { line: mapped.line, column: mapped.column + 1 };
      };
      console.log(
        source,
        el.code,
        test,
        inspect(
          good.map((v) => [
            v.functionName,
            ...v.ranges.flatMap((range) => {
              const start = toLine(range.startOffset);
              const end = toLine(range.endOffset);
              if (!start || !end) return [];
              return [
                {
                  start,
                  end,
                  count: range.count,
                },
              ];
            }),
          ]),
          false,
          4,
          true,
        ),
      );
      break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
