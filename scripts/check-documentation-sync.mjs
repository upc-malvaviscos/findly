import { readFileSync } from 'node:fs';
import { checkTraceability } from './lib/documentation-traceability.mjs';

const manifest = JSON.parse(readFileSync('docs/traceability.json', 'utf8'));
const count = checkTraceability(process.cwd(), manifest);
console.log(
  `Documentation traceability checked: ${count} requirements. Runtime evidence requires review.`,
);
