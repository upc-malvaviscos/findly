import assert from 'node:assert/strict';
import {
  flattenResources,
  inventoryConfig,
} from './terraform-permission-inventory.mjs';

function resolveUnknown(template, value, unknown) {
  if (unknown === true) {
    assert(
      template !== undefined,
      'Preflight: unknown value has no Terraform-derived template',
    );
    return template;
  }
  if (Array.isArray(value))
    return value.map((item, index) =>
      resolveUnknown(template?.[index], item, unknown?.[index]),
    );
  if (
    (value && typeof value === 'object') ||
    (unknown && typeof unknown === 'object')
  ) {
    return Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(value ?? {}),
          ...Object.keys(unknown ?? {}),
        ]),
      ].map((key) => [
        key,
        resolveUnknown(template?.[key], value?.[key], unknown?.[key]),
      ]),
    );
  }
  return value;
}

/** Resolve new-resource computed fields from a fresh mock of the SAME source.
 * Known plan inputs remain authoritative. No persisted plan/state or inventory
 * is trusted as a fallback. Namespace and policy-influencing inputs are checked.
 */
export function productionPlanResources(plan, mockedRoot, config) {
  assert.match(
    plan.format_version ?? '',
    /^1\./,
    'Preflight: unsupported Terraform plan JSON',
  );
  assert.equal(
    plan.errored ?? false,
    false,
    'Preflight: errored Terraform plan',
  );
  const actual = flattenResources(plan.planned_values?.root_module);
  assert(actual.length, 'Preflight: empty planned inventory');
  mockVariablesForPlan(plan, config);
  const ids = {
    inventoryapi: actual.find((r) => r.type === 'aws_apigatewayv2_api')?.values
      .id,
    EOACINVENTORY: actual.find(
      (r) => r.type === 'aws_cloudfront_origin_access_control',
    )?.values.id,
    EINVENTORY: actual.find((r) => r.type === 'aws_cloudfront_distribution')
      ?.values.id,
    'eu-west-1_inventory': actual.find(
      (r) => r.type === 'aws_cognito_user_pool',
    )?.values.id,
  };
  let encoded = JSON.stringify(mockedRoot).replaceAll(
    inventoryConfig.account,
    config.account,
  );
  for (const [from, to] of Object.entries(ids))
    if (to) encoded = encoded.replaceAll(from, to);
  const templates = new Map(
    flattenResources(JSON.parse(encoded)).map((resource) => [
      resource.address,
      resource,
    ]),
  );
  const changes = new Map(
    (plan.resource_changes ?? []).map((resource) => [
      resource.address,
      resource.change,
    ]),
  );
  const resources = actual.map((resource) => {
    const template = templates.get(resource.address);
    assert(
      template && template.type === resource.type,
      `${resource.address}: not covered by the fresh Terraform mock; review conditional resources`,
    );
    for (const key of [
      'name',
      'function_name',
      'bucket',
      'configuration_set_name',
      'permissions_boundary',
    ]) {
      const value = resource.values[key];
      if (typeof value === 'string' && typeof template.values[key] === 'string')
        assert.equal(
          value,
          template.values[key],
          `${resource.address}: unreviewed ${key}`,
        );
    }
    return {
      ...resource,
      values: resolveUnknown(
        template.values,
        resource.values,
        changes.get(resource.address)?.after_unknown,
      ),
    };
  });
  return { resources, changes };
}

/** Allowlisted public root inputs only; no contacts or arbitrary new variables. */
export function mockVariablesForPlan(plan, config) {
  const parameters = plan.variables ?? {};
  const allowed = new Set([
    'aws_region',
    'project',
    'cost_center',
    'data_class',
    'frontend_domain_url',
    'uploads_bucket_name',
    'alert_email',
    'enable_web',
    'web_bucket_name',
    'web_domain_name',
    'web_certificate_arn',
    'cognito_email_from_address',
    'email_identity_arn',
    'email_from_address',
    'email_gallery_origin',
  ]);
  assert(
    Object.keys(parameters).every((key) => allowed.has(key)),
    'Preflight: new root variable requires contract review',
  );
  const expected = {
    project: 'findly',
    aws_region: config.region,
    cost_center: 'findly',
    data_class: 'biometric',
    frontend_domain_url: 'https://www.findly.barcelona',
    web_domain_name: 'www.findly.barcelona',
    email_gallery_origin: 'https://www.findly.barcelona',
    uploads_bucket_name: config.uploadsBucket,
    web_bucket_name: config.webBucket,
    cognito_email_from_address: 'info@findly.barcelona',
  };
  for (const [key, value] of Object.entries(expected))
    assert(parameters[key]?.value === value, `Preflight: unreviewed ${key}`);
  const email = parameters.email_identity_arn?.value;
  assert(
    email === '' ||
      email ===
        `arn:aws:ses:${config.region}:${config.account}:identity/findly.barcelona`,
    'Preflight: foreign SES identity',
  );
  assert(
    parameters.email_from_address?.value ===
      (email ? 'info@findly.barcelona' : ''),
    'Preflight: unreviewed gallery sender',
  );
  assert(
    (parameters.alert_email?.value ?? null) === null,
    'Preflight: alert subscription needs a separately reviewed inventory case',
  );
  assert(
    typeof parameters.enable_web?.value === 'boolean',
    'Preflight: invalid web flag',
  );
  assert(
    new RegExp(
      `^arn:aws:acm:us-east-1:${config.account}:certificate/[A-Za-z0-9-]+$`,
    ).test(parameters.web_certificate_arn?.value ?? ''),
    'Preflight: unreviewed certificate reference',
  );
  return Object.fromEntries(
    Object.entries(parameters).map(([key, entry]) => [
      key,
      typeof entry.value === 'string'
        ? entry.value.replaceAll(config.account, inventoryConfig.account)
        : entry.value,
    ]),
  );
}
