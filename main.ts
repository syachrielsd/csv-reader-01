// Driver: answers every case in /input/cases.json with run() from solve.js
// and writes the answers, in order, to /output/answers.json.
//
// The two directories come from MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR when
// set (local runs), and default to /input and /output (the grader sandbox).
// solve.js is resolved next to this file, never from the working directory.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Incremental marking off before solve.js loads, so all of its work runs
// under the same flag the house baseline uses.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const answers: unknown[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  answers[i] = run(cases[i].input);
}

writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
