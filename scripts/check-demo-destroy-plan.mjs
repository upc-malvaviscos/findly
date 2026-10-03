import { readFileSync } from 'node:fs';
import {
  demoConfiguration,
  validateDestroyPlan,
} from './lib/demo-controls.mjs';
const inventory = validateDestroyPlan(
  JSON.parse(readFileSync(0, 'utf8')),
  demoConfiguration(process.env),
);
console.log(
  `Verified exact demo destruction plan: ${inventory.resources.length} owned resources.`,
);
