import assert from 'node:assert/strict';

const actors = new Set(['anyulled', 'orLuzuriaga', 'raati5674', 'surinyach']);

function trusted(comment, startedAt) {
  return (
    actors.has(comment.user?.login) &&
    Number.isFinite(Date.parse(comment.created_at)) &&
    Date.parse(comment.created_at) >= Date.parse(startedAt)
  );
}

export function hasSyntheticEvidence(comments, runId, startedAt) {
  return comments.some(
    (comment) =>
      trusted(comment, startedAt) &&
      comment.body?.trim() === `FINDLY_EMAIL_ACCEPTANCE_SYNTHETIC:${runId}`,
  );
}

export function recipientEvidence(comments, runId, startedAt) {
  const result = {};
  for (const comment of comments) {
    if (!trusted(comment, startedAt)) continue;
    const match = comment.body
      ?.trim()
      .match(/^FINDLY_EMAIL_ACCEPTANCE_RECEIPT:(\d+):(A|B) (\{[^\n]+\})$/);
    if (!match || match[1] !== String(runId)) continue;
    try {
      const proof = JSON.parse(match[3]);
      if (
        Object.keys(proof).sort().join(',') !== 'dkim,dmarc,folder,opened,spf'
      )
        continue;
      if (
        proof.spf !== 'pass' ||
        proof.dkim !== 'pass' ||
        proof.dmarc !== 'pass' ||
        proof.opened !== true ||
        !['inbox', 'spam'].includes(proof.folder)
      )
        continue;
      result[match[2]] = proof;
    } catch {
      /* Malformed public evidence never grants approval. */
    }
  }
  return result;
}

export function requireAcceptanceTimeBudget(manifest, now = Date.now()) {
  assert(
    Date.parse(manifest.expiresAt) - now >= 65 * 60 * 1000,
    'Manifest must remain valid for the run and its cleanup reserve',
  );
}
