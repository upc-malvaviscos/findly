import { existsSync } from 'node:fs';

const artifact = 'artifacts/lambdas/health.js';

if (!existsSync(artifact)) {
  throw new Error(`Missing Lambda artifact: ${artifact}`);
}
