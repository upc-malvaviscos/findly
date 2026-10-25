import assert from 'node:assert/strict';

const list = (value) => (Array.isArray(value) ? value : [value]);
const operators = new Set([
  'StringEquals',
  'StringLike',
  'ArnEquals',
  'ArnLike',
  'Bool',
]);

/** Exact glob-language inclusion for the supported IAM '*'/'?' subset. */
export function resourcePatternCovered(required, allow, deny = []) {
  const patterns = [required, ...allow, ...deny];
  assert(
    patterns.every(
      (pattern) =>
        typeof pattern === 'string' && /^[\x20-\x7e]*$/.test(pattern),
    ),
    'Unsupported non-ASCII resource pattern',
  );
  assert(
    patterns.every((p) => typeof p === 'string' && !p.includes('${')),
    'Unsupported resource pattern',
  );
  const alphabet = new Set(
    patterns.join('').replaceAll('*', '').replaceAll('?', ''),
  );
  let other = '\u0001';
  while (alphabet.has(other)) other += '\u0001';
  alphabet.add(other);
  const closure = (pattern, positions) => {
    const result = new Set(positions);
    for (const position of result)
      if (pattern[position] === '*') result.add(position + 1);
    return [...result].sort((a, b) => a - b);
  };
  const advance = (pattern, positions, char) =>
    closure(
      pattern,
      positions.flatMap((position) => {
        const token = pattern[position];
        return token === '*'
          ? [position]
          : token === '?' || token === char
            ? [position + 1]
            : [];
      }),
    );
  const pending = [patterns.map((p) => closure(p, [0]))];
  const seen = new Set();
  while (pending.length) {
    const state = pending.pop();
    const key = JSON.stringify(state);
    if (seen.has(key)) continue;
    seen.add(key);
    assert(
      seen.size <= 20000,
      'Resource-pattern contract complexity limit exceeded',
    );
    const accepts = state.map((positions, index) =>
      positions.includes(patterns[index].length),
    );
    if (
      accepts[0] &&
      (!accepts.slice(1, 1 + allow.length).some(Boolean) ||
        accepts.slice(1 + allow.length).some(Boolean))
    )
      return false;
    for (const char of alphabet) {
      const next = patterns.map((p, index) => advance(p, state[index], char));
      if (next[0].length) pending.push(next);
    }
  }
  return true;
}

function conditionMatches(statement, request) {
  const context = Object.fromEntries(
    Object.entries(request.context ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
  const contextPatterns = Object.fromEntries(
    Object.entries(request.contextPatterns ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
  return Object.entries(statement.Condition ?? {}).every(
    ([operator, entries]) =>
      Object.entries(entries).every(([key, expected]) => {
        const actual = context[key.toLowerCase()];
        if (actual === undefined) return false;
        assert.equal(
          typeof actual,
          'string',
          'Only single-valued IAM context is supported',
        );
        const required = contextPatterns[key.toLowerCase()];
        if (required !== undefined) {
          if (!operator.endsWith('Like'))
            return !/[?*]/.test(required) && list(expected).includes(required);
          return resourcePatternCovered(required, list(expected));
        }
        return list(expected).some((value) =>
          operator.endsWith('Like') ? matches(value, actual) : value === actual,
        );
      }),
  );
}

function matches(pattern, value, insensitive = false) {
  assert.equal(typeof pattern, 'string', 'IAM pattern must be a string');
  assert(
    !pattern.includes('${'),
    'IAM policy variables are outside this contract',
  );
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  return new RegExp(`^${escaped}$`, insensitive ? 'i' : '').test(value);
}

export function validateIdentityPolicy(policy) {
  assert.equal(policy.Version, '2012-10-17', 'Unsupported IAM policy version');
  assert(Array.isArray(policy.Statement), 'IAM statements must be an array');
  for (const statement of policy.Statement) {
    assert(
      ['Allow', 'Deny'].includes(statement.Effect),
      'Unsupported IAM effect',
    );
    assert(
      statement.Action && statement.Resource,
      'IAM Action/Resource required',
    );
    assert(
      !statement.NotAction && !statement.NotResource && !statement.Principal,
      'Unsupported identity policy statement',
    );
    for (const pattern of [
      ...list(statement.Action),
      ...list(statement.Resource),
    ]) {
      assert.equal(typeof pattern, 'string', 'IAM pattern must be a string');
      assert(
        !pattern.includes('${'),
        'IAM policy variables are outside this contract',
      );
    }
    for (const [operator, entries] of Object.entries(
      statement.Condition ?? {},
    )) {
      assert(
        operators.has(operator),
        `Unsupported IAM condition operator: ${operator}`,
      );
      assert(entries && typeof entries === 'object', 'Invalid IAM condition');
      for (const values of Object.values(entries))
        assert(
          list(values).every(
            (value) => typeof value === 'string' && !value.includes('${'),
          ),
          'IAM condition values must be literal strings',
        );
    }
  }
}

/** Conservative identity-policy subset, NOT AWS IAM Simulator or an SCP check. */
export function policyDecision(policies, request) {
  let allowed = false;
  for (const policy of policies) {
    validateIdentityPolicy(policy);
    for (const statement of policy.Statement) {
      if (
        !list(statement.Action).some((pattern) =>
          matches(pattern, request.action, true),
        ) ||
        !list(statement.Resource).some((pattern) =>
          matches(pattern, request.resource),
        )
      )
        continue;
      if (!conditionMatches(statement, request)) continue;
      if (statement.Effect === 'Deny') return 'explicitDeny';
      allowed = true;
    }
  }
  return allowed ? 'allowed' : 'implicitDeny';
}

export function requireResourcePattern(policies, request, source) {
  const allow = [],
    deny = [];
  for (const policy of policies) {
    validateIdentityPolicy(policy);
    for (const statement of policy.Statement) {
      if (
        !list(statement.Action).some((pattern) =>
          matches(pattern, request.action, true),
        ) ||
        !conditionMatches(statement, request)
      )
        continue;
      (statement.Effect === 'Allow' ? allow : deny).push(
        ...list(statement.Resource),
      );
    }
  }
  assert(
    resourcePatternCovered(request.resource, allow, deny),
    `${source}: boundary does not cover ${request.action} on ${request.resource}`,
  );
}

export function requirePermission(policies, request, source) {
  const decision = policyDecision(policies, request);
  assert.equal(
    decision,
    'allowed',
    `${source}: ${request.action} on ${request.resource}: ${decision}`,
  );
}
