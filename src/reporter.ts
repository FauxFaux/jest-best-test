import { writeFile } from 'fs/promises';
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
    console.log(`START ${testFilePath}`);

    const cleaned = await pMap(
      coverage,
      async (cov) => {
        const tr = cov.codeTransformResult;
        if (!tr) throw new Error('no transform result');

        const codeFile = await writeTemporaryFile(
          tr.code.replace(/\n\/\/# sourceMappingURL=[^\n]+$/, ''),
        );
        const originalCodeFile = await writeTemporaryFile(tr.originalCode);
        const [code, originalCode, sourceMap] = await hashObjects([
          codeFile.path,
          originalCodeFile.path,
          tr.sourceMapPath!,
        ]);
        void codeFile.cleanup();
        void originalCodeFile.cleanup();

        return {
          codeTransformResult: {
            code,
            originalCode,
            sourceMap,
            wrapperLength: tr.wrapperLength,
          },
          result: cov.result,
        };
      },
      { concurrency: 32 },
    );

    console.log(`DONE  ${testFilePath}`);

    await writeFile(`${testFilePath}.covdata`, JSON.stringify(cleaned));
  }
}

type Hash = string;

async function writeTemporaryFile(
  input: string | Buffer,
): ReturnType<typeof tmp.file> {
  const f = await tmp.file();
  await writeFile(f.path, input);
  console.log(f.path);
  return f;
}

async function hashObjects(paths: string[]): Promise<Hash[]> {
  const { stdout } = await execa('git', ['hash-object', '-w', ...paths], {
    encoding: 'utf-8',
  });
  return stdout.trim().split('\n');
  // return ['a','b','c'];
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
