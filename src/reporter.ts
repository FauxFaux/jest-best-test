import { writeFile } from 'fs/promises';
import { brotliCompressSync, constants } from 'zlib';
import execa from 'execa';
import pMap from 'p-map';
import * as tmp from 'tmp-promise';
import {
  AggregatedResult,
  BaseReporter,
  Context,
  Test,
  TestResult,
} from '@jest/reporters';

export default class SavingReporter extends BaseReporter {
  async onTestResult(
    test: Test,
    testResult: TestResult,
    results: AggregatedResult,
  ): Promise<void> {
    await super.onTestResult(test, testResult, results);

    if (0 !== testResult.numFailingTests) return;

    const coverage = testResult.v8Coverage;
    if (!coverage) return;

    const testFilePath = relativePath(test.context, testResult.testFilePath);

    const cleaned = await pMap(
      coverage,
      async (cov) => {
        const tr = cov.codeTransformResult;
        if (!tr) throw new Error('no transform result');

        // the source map is embedded in the code, so not storing it twice
        const codeFile = await writeTemporaryFile(tr.code);
        const originalCodeFile = await writeTemporaryFile(tr.originalCode);

        return {
          files: [codeFile, originalCodeFile] as const,
          result: cov.result,
        };
      },
      { concurrency: 32 },
    );

    // files is a 2-tuple
    const hashes = await hashObjects(
      cleaned.flatMap(({ files }) => files.map(({ path }) => path)),
    );

    await pMap(
      cleaned.flatMap(({ files }) => files),
      (f) => f.cleanup(),
      { concurrency: 32 },
    );

    const output: unknown[] = [];
    // unpack the 2-tuples of files back to fields
    for (let i = 0; i < cleaned.length; ++i) {
      output.push({
        result: cleaned[i].result,
        code: hashes[i * 2],
        originalCode: hashes[i * 2 + 1],
      });
    }

    await writeFile(
      `${testFilePath}.covdata.br`,
      brotliCompressSync(JSON.stringify(output), {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 1,
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        },
      }),
    );
  }
}

type Hash = string;

async function writeTemporaryFile(
  input: string | Buffer,
): ReturnType<typeof tmp.file> {
  const f = await tmp.file();
  // TODO: write to fd?
  await writeFile(f.path, input);
  return f;
}

async function hashObjects(paths: string[]): Promise<Hash[]> {
  const { stdout } = await execa(
    'git',
    ['hash-object', '-w', '--stdin-paths'],
    {
      encoding: 'utf-8',
      input: paths.join('\n'),
    },
  );
  return stdout.trim().split('\n');
}

// close enough
function slash(path: string): string {
  return path.replace(/\\/g, '/');
}

export function relativePath(
  context: Pick<Context, 'config'>,
  testPath: string,
): string {
  let root = slash(context.config.rootDir);
  if (!root.endsWith('/')) {
    root += '/';
  }

  testPath = slash(testPath);

  if (testPath.startsWith(root)) {
    return testPath.substr(root.length);
  }

  return testPath;
}
