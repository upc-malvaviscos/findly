import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const sourceDir = 'src/lambdas';
const artifactsDir = 'artifacts/lambdas';

const sources = readdirSync(sourceDir).filter(
  (file) => extname(file) === '.ts',
);

if (sources.length === 0)
  throw new Error(`No Lambda sources found in ${sourceDir}.`);

for (const source of sources) {
  const base = source.slice(0, -'.ts'.length);
  for (const extension of ['.js', '.zip']) {
    const artifact = join(artifactsDir, `${base}${extension}`);
    if (!existsSync(artifact))
      throw new Error(`Missing Lambda artifact: ${artifact}`);
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'findly-lambda-'));
  try {
    const temporaryBundle = join(temporaryDirectory, 'index.js');
    copyFileSync(join(artifactsDir, `${base}.js`), temporaryBundle);
    execFileSync(process.execPath, ['-e', 'require("./index.js")'], {
      cwd: temporaryDirectory,
      stdio: 'ignore',
    });
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

console.log(`Verified ${sources.length} Lambda artifact(s).`);
