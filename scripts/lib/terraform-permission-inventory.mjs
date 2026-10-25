import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export const inventoryConfig = Object.freeze({
  account: '123456789012',
  region: 'eu-west-1',
  stateBucket: 'findly-terraform-state-123456789012',
  uploadsBucket: 'findly-production-uploads-123456789012-eu-west-1',
  webBucket: 'findly-production-web-123456789012-eu-west-1',
});

export const inventoryVariables = Object.freeze({
  aws_region: 'eu-west-1',
  project: 'findly',
  cost_center: 'findly',
  data_class: 'biometric',
  frontend_domain_url: 'https://www.findly.barcelona',
  uploads_bucket_name: inventoryConfig.uploadsBucket,
  enable_web: true,
  web_bucket_name: inventoryConfig.webBucket,
  web_domain_name: 'www.findly.barcelona',
  web_certificate_arn:
    'arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-4000-8000-000000000000',
  cognito_email_from_address: 'info@findly.barcelona',
  email_identity_arn:
    'arn:aws:ses:eu-west-1:123456789012:identity/findly.barcelona',
  email_from_address: 'info@findly.barcelona',
  email_gallery_origin: 'https://www.findly.barcelona',
  alert_email: null,
});

export function flattenResources(root) {
  assert(
    root && typeof root === 'object',
    'Missing Terraform JSON root_module',
  );
  return [
    ...(root.resources ?? []).filter((resource) => resource.mode === 'managed'),
    ...(root.child_modules ?? []).flatMap(flattenResources),
  ];
}

/** Deterministic computed attributes for mock resources, derived from the plan. */
export function inventoryOverrides(resource, config = inventoryConfig) {
  const v = resource.change.after;
  const { account, region } = config;
  const arn = (service, path) =>
    `arn:aws:${service}:${region}:${account}:${path}`;
  switch (resource.type) {
    case 'aws_iam_role':
      return { arn: `arn:aws:iam::${account}:role/${v.name}`, id: v.name };
    case 'aws_lambda_function': {
      const value = arn('lambda', `function:${v.function_name}`);
      return {
        arn: value,
        invoke_arn: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${value}/invocations`,
      };
    }
    case 'aws_sqs_queue': {
      const url = `https://sqs.${region}.amazonaws.com/${account}/${v.name}`;
      return { arn: arn('sqs', v.name), id: url, url };
    }
    case 'aws_sns_topic':
      return {
        arn: arn('sns', v.name),
        id: arn('sns', v.name),
        owner: account,
      };
    case 'aws_dynamodb_table':
      return { arn: arn('dynamodb', `table/${v.name}`), id: v.name };
    case 'aws_s3_bucket':
      return { arn: `arn:aws:s3:::${v.bucket}`, id: v.bucket };
    case 'aws_cloudwatch_log_group':
      return { arn: arn('logs', `log-group:${v.name}`), id: v.name };
    case 'aws_cloudwatch_metric_alarm':
      return {
        arn: arn('cloudwatch', `alarm:${v.alarm_name}`),
        id: v.alarm_name,
      };
    case 'aws_apigatewayv2_api':
      return {
        id: 'inventoryapi',
        arn: `arn:aws:apigateway:${region}::/apis/inventoryapi`,
        execution_arn: arn('execute-api', 'inventoryapi'),
        api_endpoint:
          'https://inventoryapi.execute-api.eu-west-1.amazonaws.com',
      };
    case 'aws_cognito_user_pool':
      return {
        id: 'eu-west-1_inventory',
        arn: arn('cognito-idp', 'userpool/eu-west-1_inventory'),
        endpoint: `cognito-idp.${region}.amazonaws.com/eu-west-1_inventory`,
      };
    case 'aws_cloudfront_distribution':
      return {
        id: 'EINVENTORY',
        arn: `arn:aws:cloudfront::${account}:distribution/EINVENTORY`,
        domain_name: 'inventory.cloudfront.net',
      };
    case 'aws_cloudfront_origin_access_control':
      return { id: 'EOACINVENTORY' };
    case 'aws_sesv2_configuration_set':
      return {
        arn: arn('ses', `configuration-set/${v.configuration_set_name}`),
      };
    case 'aws_scheduler_schedule':
      return { arn: arn('scheduler', `schedule/default/${v.name}`) };
    default:
      return null;
  }
}

/** Isolated mock-provider execution: no backend, profiles, credentials or state. */
export function terraformPermissionState(
  repository = process.cwd(),
  variables = inventoryVariables,
) {
  const workspace = mkdtempSync(join(tmpdir(), 'findly-permissions-'));
  try {
    cpSync(resolve(repository, 'infra'), join(workspace, 'infra'), {
      recursive: true,
      filter: (path) =>
        !path.split(sep).includes('.terraform') &&
        (statSync(path).isDirectory() ||
          /(?:\.tf|\.tf\.json|\.tftest\.hcl|\.terraform\.lock\.hcl)$/.test(
            path,
          )),
    });
    cpSync(
      resolve(repository, 'artifacts/lambdas'),
      join(workspace, 'artifacts/lambdas'),
      {
        recursive: true,
        filter: (path) => statSync(path).isDirectory() || path.endsWith('.zip'),
      },
    );
    const emptyConfig = join(workspace, 'empty-aws-config');
    writeFileSync(emptyConfig, '', { mode: 0o600 });
    const cache = join(workspace, 'cache');
    mkdirSync(cache);
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          !name.startsWith('AWS_') &&
          !name.startsWith('TF_') &&
          !name.startsWith('FINDLY_') &&
          !name.startsWith('EPHEMERAL_'),
      ),
    );
    const env = {
      ...inherited,
      AWS_CONFIG_FILE: emptyConfig,
      AWS_SHARED_CREDENTIALS_FILE: emptyConfig,
      AWS_EC2_METADATA_DISABLED: 'true',
      AWS_REGION: 'eu-west-1',
      AWS_DEFAULT_REGION: 'eu-west-1',
      TF_DATA_DIR: join(workspace, 'data'),
      TF_PLUGIN_CACHE_DIR: cache,
      TF_WORKSPACE: 'default',
      TF_IN_AUTOMATION: 'true',
    };
    const root = join(workspace, 'infra/environments/production');
    const execute = (args) => {
      try {
        return execFileSync('terraform', [`-chdir=${root}`, ...args], {
          env,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        const diagnostics = (error.stdout ?? '').split('\n').flatMap((line) => {
          try {
            const m = JSON.parse(line);
            return m.diagnostic?.severity === 'error'
              ? [m.diagnostic.summary]
              : [];
          } catch {
            return [];
          }
        });
        throw new Error(
          `Terraform mock inventory failed: ${diagnostics.join('; ') || 'provider initialization or execution failed'}`,
        );
      }
    };
    execute(['init', '-backend=false', '-input=false', '-lockfile=readonly']);
    const fixture = join(root, 'tests/permissions-inventory.tftest.hcl');
    const source = readFileSync(fixture, 'utf8');
    writeFileSync(
      join(root, 'permission-inputs.tfvars.json'),
      JSON.stringify(variables),
      { mode: 0o600 },
    );
    const run = () =>
      execute([
        'test',
        '-json',
        '-verbose',
        '-filter=tests/permissions-inventory.tftest.hcl',
        '-var-file=permission-inputs.tfvars.json',
      ])
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    writeFileSync(fixture, source.replace('command = apply', 'command = plan'));
    const plan = run().find(
      (message) => message.type === 'test_plan',
    )?.test_plan;
    assert(
      plan?.resource_changes?.length,
      'Missing Terraform mock plan resources',
    );
    const overrides = plan.resource_changes
      .filter((r) => r.mode === 'managed')
      .flatMap((resource) => {
        const values = inventoryOverrides(resource);
        return values
          ? [
              `override_resource {\n  target = ${resource.address}\n  values = ${JSON.stringify(values)}\n}\n`,
            ]
          : [];
      });
    writeFileSync(fixture, `${source}\n${overrides.join('\n')}`);
    const messages = run();
    const summary = messages.find((message) => message.type === 'test_summary');
    assert.equal(
      summary?.test_summary?.status,
      'pass',
      'Terraform permission mock failed',
    );
    const states = messages.filter((message) => message.type === 'test_state');
    assert.equal(
      states.length,
      1,
      'Expected one complete mocked Terraform graph',
    );
    return states[0].test_state;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
