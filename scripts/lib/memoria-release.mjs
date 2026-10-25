import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { verifyMainCommit } from './memoria-source.mjs';

const sourceMarker = (sha) => `<!-- memoria-source:${sha} -->`;

export async function completedMemoriaRelease(github, repository, sha) {
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...repository,
    per_page: 100,
  });
  const release = releases.find((item) =>
    item.body?.includes(sourceMarker(sha)),
  );
  if (!release || release.draft) return undefined;
  if (
    release.target_commitish !== sha ||
    !release.assets.some(
      (asset) => asset.name === 'memoria.pdf' && asset.state === 'uploaded',
    )
  )
    throw new Error('Published release has no completed matching PDF.');
  const commit = (
    await github.rest.repos.getCommit({ ...repository, ref: release.tag_name })
  ).data;
  if (commit.sha !== sha)
    throw new Error('Published tag no longer matches the source commit.');
  return release.html_url;
}

export function memoriaTag(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  return `memoria-${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}`;
}

async function optional(request) {
  try {
    return (await request()).data;
  } catch (error) {
    if (error.status === 404) return undefined;
    throw error;
  }
}

export async function publishMemoria({
  github,
  context,
  sourceSha = context.sha,
  automationSha,
  pdfPath,
  now = () => new Date(),
  sleep = setTimeout,
}) {
  if (
    !['push', 'workflow_run', 'workflow_dispatch'].includes(
      context.eventName,
    ) ||
    context.ref !== 'refs/heads/main'
  )
    throw new Error('PDF releases require an authorized main event.');
  await verifyMainCommit(github, context.repo, sourceSha);
  if (automationSha && !/^[a-f0-9]{40}$/.test(automationSha))
    throw new Error('Invalid automation commit.');
  const pdf = readFileSync(pdfPath);
  if (pdf.subarray(0, 5).toString() !== '%PDF-')
    throw new Error('Invalid PDF.');
  const repository = context.repo;
  const marker = sourceMarker(sourceSha);
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...repository,
    per_page: 100,
  });
  let release = releases.find((item) => item.body?.includes(marker));

  // Re-running an Actions run resumes its draft or returns its published release.
  // Other runs, including another merge in the same minute or DST fold, get a new slot.
  if (!release) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const tag = memoriaTag(now());
      const existing =
        releases.find((item) => item.tag_name === tag) ??
        (await optional(() =>
          github.rest.repos.getReleaseByTag({ ...repository, tag }),
        ));
      const ref = await optional(() =>
        github.rest.git.getRef({ ...repository, ref: `tags/${tag}` }),
      );
      if (!existing && !ref) {
        release = (
          await github.rest.repos.createRelease({
            ...repository,
            tag_name: tag,
            target_commitish: sourceSha,
            name: `Memoria Findly · ${tag.slice('memoria-'.length)} (Europe/Madrid)`,
            body:
              `${marker}\n\nMemoria académica compilada desde ${sourceSha}.\n\n` +
              (automationSha
                ? `Automatización y toolchain: ${automationSha}.\n\n`
                : '') +
              `Ejecución: https://github.com/${repository.owner}/${repository.repo}/actions/runs/${context.runId}\n\n` +
              'Descarga `memoria.pdf` en los assets de esta release. Zona horaria: Europe/Madrid.',
            draft: true,
            prerelease: false,
            make_latest: 'false',
          })
        ).data;
        break;
      }
      if (attempt === 4)
        throw new Error(
          'No free release minute after five attempts; rerun this workflow later.',
        );
      await sleep(61_000);
    }
  }
  if (release.target_commitish !== sourceSha)
    throw new Error('Release source does not match the workflow commit.');
  if (!release.draft) {
    const commit = (
      await github.rest.repos.getCommit({
        ...repository,
        ref: release.tag_name,
      })
    ).data;
    if (commit.sha !== sourceSha)
      throw new Error('Published tag no longer matches the source commit.');
    if (
      !release.assets.some(
        (asset) => asset.name === 'memoria.pdf' && asset.state === 'uploaded',
      )
    )
      throw new Error('Published release has no completed PDF asset.');
    return release.html_url;
  }
  // Never replace assets of a published release. A completed draft upload can
  // survive a failed publish and is reused on retry.
  const asset = release.assets.find((item) => item.name === 'memoria.pdf');
  if (asset && asset.state !== 'uploaded')
    throw new Error(
      'Incomplete draft upload; inspect the draft before retrying.',
    );
  if (!asset)
    await github.rest.repos.uploadReleaseAsset({
      ...repository,
      release_id: release.id,
      name: 'memoria.pdf',
      data: pdf,
      headers: {
        'content-type': 'application/pdf',
        'content-length': pdf.length,
      },
    });
  // A pre-existing tag must still identify this source (including draft retries).
  const ref = await optional(() =>
    github.rest.git.getRef({ ...repository, ref: `tags/${release.tag_name}` }),
  );
  if (ref) {
    const commit = (
      await github.rest.repos.getCommit({
        ...repository,
        ref: release.tag_name,
      })
    ).data;
    if (commit.sha !== sourceSha)
      throw new Error('Release tag belongs to another commit.');
  }
  const published = await github.rest.repos.updateRelease({
    ...repository,
    release_id: release.id,
    draft: false,
    make_latest: 'false',
  });
  return published.data.html_url;
}
