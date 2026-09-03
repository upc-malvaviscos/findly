import { existsSync, readFileSync } from 'node:fs';

const requiredReferences = [
  ['README.md', 'React + Vite'],
  ['docs/paper/05-implementacion-y-cicd.md', 'React + Vite'],
  ['docs/adr/ADR-001-vite-react-over-nextjs.md', 'React + Vite'],
];

const failures = requiredReferences.flatMap(([file, expectedText]) => {
  if (!existsSync(file)) {
    return [`Missing required documentation file: ${file}`];
  }

  return readFileSync(file, 'utf8').includes(expectedText)
    ? []
    : [`${file} must reference ${expectedText}`];
});

if (failures.length > 0) {
  throw new Error(`Documentation is not synchronized:\n${failures.join('\n')}`);
}
