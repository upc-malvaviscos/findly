import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';

const artifactsDir = 'artifacts/lambdas';

if (!existsSync(artifactsDir)) {
  throw new Error(`Missing Lambda build output directory: ${artifactsDir}`);
}

const bundles = readdirSync(artifactsDir).filter(
  (file) => extname(file) === '.js',
);

if (bundles.length === 0) {
  throw new Error(`No Lambda bundles found in ${artifactsDir}.`);
}

for (const bundle of bundles) {
  const zipName = `${bundle.slice(0, -'.js'.length)}.zip`;
  const zipPath = join(artifactsDir, zipName);
  rmSync(zipPath, { force: true });

  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${join(artifactsDir, bundle)}' -DestinationPath '${zipPath}' -Force`,
    ]);
  } else {
    execFileSync('zip', ['-j', zipPath, join(artifactsDir, bundle)]);
  }

  if (!existsSync(zipPath))
    throw new Error(`Failed to package Lambda artifact: ${zipPath}`);
}

console.log(`Packaged ${bundles.length} Lambda artifact(s) as .zip.`);
