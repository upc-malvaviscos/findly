import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

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
}

console.log(`Verified ${sources.length} Lambda artifact(s).`);
