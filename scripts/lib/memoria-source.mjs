import { setTimeout } from 'node:timers/promises';

const files = new Set([
  'docs/paper/memoria-findly/memoria-postgrado.md',
  'docs/paper/memoria-findly/portada.tex',
  'docs/paper/memoria-findly/Makefile',
  'docs/paper/memoria-findly/pdf-toolchain.json',
  'scripts/pandoc-container.mjs',
  'scripts/lib/memoria-release.mjs',
  'scripts/lib/memoria-release.d.mts',
  'scripts/lib/memoria-source.mjs',
  'scripts/lib/memoria-source.d.mts',
  'tests/infra/memoriaRelease.test.ts',
  'tests/infra/memoriaSource.test.ts',
  '.github/workflows/memoria-pdf.yml',
  '.nvmrc',
]);

export function affectsMemoria(path) {
  return files.has(path) || path.startsWith('docs/paper/memoria-findly/img/');
}

export async function verifyMainCommit(github, repository, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid source commit.');
  const { data } = await github.rest.repos.compareCommitsWithBasehead({
    ...repository,
    basehead: `${sha}...main`,
    per_page: 1,
  });
  if (!['ahead', 'identical'].includes(data.status))
    throw new Error('PDF source is not an ancestor of main.');
}

// All inputs are GitHub metadata, not PR code/artifacts. The caller checks out
// this module from main; the document checkout happens only after this resolves.
export async function resolveMemoriaSource({
  github,
  context,
  sleep = setTimeout,
}) {
  if (context.ref !== 'refs/heads/main') return undefined;
  const repository = context.repo;
  const fullName = `${repository.owner}/${repository.repo}`;
  let triggerSha;
  let numbers = [];
  if (context.eventName === 'workflow_run') {
    const run = context.payload.workflow_run;
    if (
      run?.conclusion !== 'success' ||
      run.head_repository?.full_name !== fullName ||
      !(
        ['CI', 'Ephemeral PR environment'].includes(run.name) ||
        run.path === 'dynamic/github-code-scanning/codeql'
      )
    )
      return undefined;
    triggerSha = run.head_sha;
    numbers = (run.pull_requests ?? []).map((pr) => pr.number);
  } else if (
    context.eventName === 'push' ||
    context.eventName === 'workflow_dispatch'
  ) {
    triggerSha = context.payload.inputs?.source_sha || context.sha;
  } else return undefined;
  if (!/^[a-f0-9]{40}$/.test(triggerSha))
    throw new Error('Invalid trigger commit.');

  if (!numbers.length) {
    const { data } =
      await github.rest.repos.listPullRequestsAssociatedWithCommit({
        ...repository,
        commit_sha: triggerSha,
        per_page: 100,
      });
    if (data.length === 100)
      throw new Error('Ambiguous source; too many associated PRs.');
    numbers = data.map((pr) => pr.number);
  }
  for (const number of numbers) {
    let pr;
    for (let attempt = 0; attempt < 25; attempt++) {
      pr = (await github.rest.pulls.get({ ...repository, pull_number: number }))
        .data;
      if (
        pr.base.ref !== 'main' ||
        pr.base.repo.full_name !== fullName ||
        pr.head.repo?.full_name !== fullName
      )
        break;
      // CI's branch SHA differs from the merge SHA under rebase merging.
      if (pr.head.sha !== triggerSha && pr.merge_commit_sha !== triggerSha)
        break;
      if (pr.merged) {
        if (!pr.merge_commit_sha)
          throw new Error('Merged PR has no merge commit.');
        await verifyMainCommit(github, repository, pr.merge_commit_sha);
        if (pr.changed_files > 3000)
          throw new Error('PR exceeds the file enumeration limit.');
        let relevant = false;
        let counted = 0;
        for (let page = 1; page <= 30; page++) {
          const { data } = await github.rest.pulls.listFiles({
            ...repository,
            pull_number: number,
            per_page: 100,
            page,
          });
          counted += data.length;
          relevant ||= data.some(
            (file) =>
              affectsMemoria(file.filename) ||
              (file.previous_filename &&
                affectsMemoria(file.previous_filename)),
          );
          if (data.length < 100) break;
        }
        if (counted !== pr.changed_files)
          throw new Error('Incomplete PR file enumeration.');
        return relevant
          ? { sha: pr.merge_commit_sha, pullNumber: number }
          : undefined;
      }
      // The final check completion can precede auto-merge by a few seconds.
      // Other callbacks will also run; manual recovery is available if GitHub
      // takes longer than this bounded two-minute window.
      if (
        !pr.auto_merge ||
        context.eventName !== 'workflow_run' ||
        attempt === 24
      )
        break;
      await sleep(5000);
    }
  }
  return undefined;
}
