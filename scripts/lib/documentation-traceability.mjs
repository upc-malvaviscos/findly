import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';

const file = z.string().min(1);
const schema = z
  .object({
    version: z.literal(1),
    requirements: z
      .array(
        z
          .object({
            id: z.string().regex(/^REQ-[A-Z0-9-]+$/),
            description: z.string().min(1),
            issues: z.array(z.number().int().positive()).nonempty(),
            spec: file,
            implementation: z.array(file).nonempty(),
            verification: z
              .array(
                z
                  .object({
                    command: z.string().min(1),
                    environment: z.enum(['static', 'unit', 'floci', 'aws']),
                    files: z.array(file).nonempty(),
                  })
                  .strict(),
              )
              .nonempty(),
            evidence: z
              .array(
                z
                  .object({
                    file,
                    environment: z.enum(['static', 'unit', 'floci', 'aws']),
                  })
                  .strict(),
              )
              .nonempty(),
            documentation: z.array(file).nonempty(),
          })
          .strict(),
      )
      .nonempty(),
  })
  .strict();

export function checkTraceability(repository, input) {
  const manifest = schema.parse(input);
  const root = realpathSync(repository);
  const failures = [];
  const ids = new Set();
  const packageJson = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  );
  const checkFile = (path, requirement) => {
    try {
      if (
        isAbsolute(path) ||
        path.includes('\\') ||
        path.split('/').some((part) => part === '..' || !part)
      )
        throw new Error('Invalid repository-relative path');
      const target = realpathSync(resolve(root, path));
      if (relative(root, target).startsWith('..') || !statSync(target).isFile())
        throw new Error('Not a repository file');
      return target;
    } catch {
      failures.push(`${requirement}: missing or unsafe file ${path}`);
      return null;
    }
  };
  for (const requirement of manifest.requirements) {
    const { id, spec } = requirement;
    if (ids.has(id)) failures.push(`Duplicate requirement ${id}`);
    ids.add(id);
    if (!spec.startsWith('specs/') || !spec.endsWith('.md'))
      failures.push(`${id}: invalid spec path`);
    const files = [
      spec,
      ...requirement.implementation,
      ...requirement.documentation,
      ...requirement.verification.flatMap((item) => item.files),
      ...requirement.evidence.map((item) => item.file),
    ];
    for (const path of new Set(files)) checkFile(path, id);
    for (const path of [
      spec,
      ...requirement.evidence.map((item) => item.file),
    ]) {
      const target = checkFile(path, id);
      if (
        target &&
        !readFileSync(target, 'utf8').includes(`<!-- requirement: ${id} -->`)
      )
        failures.push(`${id}: missing requirement declaration in ${path}`);
    }
    const specTarget = checkFile(spec, id);
    if (specTarget) {
      const links = [
        ...readFileSync(specTarget, 'utf8').matchAll(/\]\(([^\s)]+)\)/g),
      ].map((match) => match[1]);
      for (const issue of requirement.issues) {
        if (
          !links.includes(
            `https://github.com/upc-malvaviscos/findly/issues/${issue}`,
          )
        )
          failures.push(`${id}: spec does not link issue #${issue}`);
      }
      for (const evidence of requirement.evidence) {
        if (
          !links.some(
            (link) =>
              !/^[a-z]+:/i.test(link) &&
              resolve(dirname(specTarget), link.split('#')[0]) ===
                resolve(root, evidence.file),
          )
        )
          failures.push(`${id}: spec does not link evidence ${evidence.file}`);
      }
    }
    for (const verification of requirement.verification) {
      if (!Object.hasOwn(packageJson.scripts ?? {}, verification.command))
        failures.push(`${id}: unknown npm script ${verification.command}`);
      if (
        !requirement.evidence.some(
          (item) => item.environment === verification.environment,
        )
      )
        failures.push(
          `${id}: no evidence reference for ${verification.environment}`,
        );
    }
  }
  const byId = new Map(
    manifest.requirements.map((requirement) => [requirement.id, requirement]),
  );
  for (const path of readdirSync(resolve(root, 'specs'), { recursive: true })) {
    if (typeof path !== 'string' || !path.endsWith('.md')) continue;
    const spec = `specs/${path.split('\\').join('/')}`;
    const target = checkFile(spec, 'spec declarations');
    if (!target) continue;
    const declarations = readFileSync(target, 'utf8').matchAll(
      /<!-- requirement: (REQ-[A-Z0-9-]+) -->/g,
    );
    for (const declaration of declarations) {
      const requirement = byId.get(declaration[1]);
      if (!requirement || requirement.spec !== spec)
        failures.push(`Orphaned requirement ${declaration[1]} in ${spec}`);
    }
  }
  if (failures.length)
    throw new Error(
      `Documentation traceability failed:\n${failures.join('\n')}`,
    );
  return manifest.requirements.length;
}
