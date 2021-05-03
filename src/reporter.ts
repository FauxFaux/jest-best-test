import { writeFile, readFile } from 'fs/promises';
import * as child from 'child_process';
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
    console.log('RESULT');

    if (0 !== testResult.numFailingTests) return;

    const coverage = testResult.v8Coverage;
    if (!coverage) return;

    const testFilePath = relativePath(test.context, testResult.testFilePath);

    const cleaned = [];

    for (const cov of coverage) {
      const tr = cov.codeTransformResult;
      if (!tr) throw new Error('no transform result');
      const sourceMap = await readFile(tr.sourceMapPath!);
      console.log('RECORD');
      cleaned.push({
        codeTransformResult: {
          code: writeObject(
            tr.code.replace(/\n\/\/# sourceMappingURL=[^\n]+$/, ''),
          ),
          originalCode: writeObject(tr.originalCode),
          sourceMap: writeObject(sourceMap),
          wrapperLength: tr.wrapperLength,
        },
        result: cov.result,
      });
    }

    console.log('CLEANED');

    await writeFile(`${testFilePath}.covdata`, JSON.stringify(cleaned));
  }
}

type Hash = string;

function writeObject(input: string | Buffer): Hash {
  return (
    'git:' +
    child
      .execFileSync('git', ['hash-object', '-w', '--stdin'], {
        input,
        encoding: 'utf-8',
        timeout: 5000,
      })
      .trim()
  );
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
