import { existsSync, readFileSync } from 'node:fs';

const requiredReferences = [
  ['README.md', 'React + Vite'],
  ['docs/paper/05-implementacion-y-cicd.md', 'React + Vite'],
  ['docs/adr/ADR-001-vite-react-over-nextjs.md', 'React + Vite'],
];

const requiredTraceability = [
  [
    'specs/16-unit-contract-integration-and-e2e-validation.md',
    ['#17', '19-local-execution-modes-and-verification-matrix.md'],
  ],
  [
    'specs/19-local-execution-modes-and-verification-matrix.md',
    ['#51', '#52', '#53', '#54', 'issue-51-54-local-execution-modes.md'],
  ],
  [
    'docs/evidence/issue-51-54-local-execution-modes.md',
    ['PR #55', 'PR #56', 'PR #57', 'npm run test:aws'],
  ],
  [
    'AGENTS.md',
    ['implementación, las specs y las issues de GitHub', 'npm run sync:check'],
  ],
];

const failures = requiredReferences.flatMap(([file, expectedText]) => {
  if (!existsSync(file)) {
    return [`Missing required documentation file: ${file}`];
  }

  return readFileSync(file, 'utf8').includes(expectedText)
    ? []
    : [`${file} must reference ${expectedText}`];
});

for (const [file, expectedTexts] of requiredTraceability) {
  if (!existsSync(file)) {
    failures.push(`Missing required traceability file: ${file}`);
    continue;
  }

  const contents = readFileSync(file, 'utf8');
  for (const expectedText of expectedTexts) {
    if (!contents.includes(expectedText)) {
      failures.push(`${file} must reference ${expectedText}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Documentation is not synchronized:\n${failures.join('\n')}`);
}
