import assert from 'node:assert/strict';
import { validateIdentityPolicy } from './iam-policy-evaluation.mjs';

export function decodePolicyDocument(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = JSON.parse(decodeURIComponent(value));
    }
  }
  validateIdentityPolicy(value);
  return value;
}

/** Read-only, injected AWS adapter. No simulation, grants or role creation. */
export function appliedProductionPolicies(aws, config) {
  const identity = aws('sts', 'get-caller-identity');
  assert.equal(
    identity.Account,
    config.account,
    'Preflight: wrong AWS account',
  );
  assert.match(
    identity.Arn,
    new RegExp(
      `^arn:aws:sts::${config.account}:assumed-role/findly-production-deploy/[^/]+$`,
    ),
    'Preflight requires the production deployment role',
  );
  const name = 'findly-production-deploy';
  const roleArn = `arn:aws:iam::${config.account}:role/${name}`;
  const boundaryArn = `arn:aws:iam::${config.account}:policy/findly-production-runtime-boundary`;
  const role = aws('iam', 'get-role', { RoleName: name }).Role;
  assert.equal(role.Arn, roleArn, 'Preflight: foreign deployment role');
  const tags = Object.fromEntries(
    (role.Tags ?? []).map(({ Key, Value }) => [Key, Value]),
  );
  assert.equal(
    tags.Project,
    'findly',
    'Preflight: role has no Findly ownership',
  );
  assert.equal(
    tags.Environment,
    'production',
    'Preflight: role belongs to another environment',
  );
  const pages = (command, key) => {
    const result = [],
      seen = new Set();
    let marker;
    do {
      const page = aws('iam', command, {
        RoleName: name,
        ...(marker && { Marker: marker }),
      });
      assert(
        Array.isArray(page[key]),
        `Preflight: incomplete ${command} response`,
      );
      result.push(...page[key]);
      if (!page.IsTruncated) break;
      assert(
        page.Marker && !seen.has(page.Marker),
        'Preflight: invalid IAM pagination',
      );
      seen.add(page.Marker);
      marker = page.Marker;
      assert(seen.size < 100, 'Preflight: IAM pagination limit');
    } while (marker);
    return result;
  };
  const managed = (policyArn) => {
    assert(
      policyArn === boundaryArn ||
        new RegExp(
          `^arn:aws:iam::${config.account}:policy/findly-production-deploy-[0-9]+$`,
        ).test(policyArn),
      'Preflight: unreviewed managed policy or deploy boundary',
    );
    const policy = aws('iam', 'get-policy', { PolicyArn: policyArn }).Policy;
    assert.equal(policy.Arn, policyArn, 'Preflight: policy ARN mismatch');
    assert(
      policy.DefaultVersionId,
      'Preflight: missing current policy version',
    );
    return decodePolicyDocument(
      aws('iam', 'get-policy-version', {
        PolicyArn: policyArn,
        VersionId: policy.DefaultVersionId,
      }).PolicyVersion.Document,
    );
  };
  const deploy = pages('list-attached-role-policies', 'AttachedPolicies').map(
    (p) => managed(p.PolicyArn),
  );
  for (const PolicyName of pages('list-role-policies', 'PolicyNames')) {
    deploy.push(
      decodePolicyDocument(
        aws('iam', 'get-role-policy', { RoleName: name, PolicyName })
          .PolicyDocument,
      ),
    );
  }
  assert(deploy.length, 'Preflight: no applied deployment policies');
  const runtimeBoundary = managed(boundaryArn);
  const deployBoundary = role.PermissionsBoundary
    ? managed(role.PermissionsBoundary.PermissionsBoundaryArn)
    : undefined;
  return { deploy, runtimeBoundary, deployBoundary };
}
