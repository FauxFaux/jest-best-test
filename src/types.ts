import type { Profiler } from 'inspector';

export type Hash = string;

export interface CovDataElement {
  result: Profiler.ScriptCoverage;
  wrapperLength: number;
  code: Hash;
  originalCode: Hash;
}

export interface CovDataFile {
  version: 1;
  testFilePath: string;
  sourceFilesCovered: CovDataElement[];
  duration: number;
}
