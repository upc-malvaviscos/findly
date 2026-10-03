import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const demoActors = ['anyulled', 'orLuzuriaga', 'raati5674', 'surinyach'];
export const demoStateKey = 'findly/demo/terraform.tfstate';
export const destroyConfirmation = 'DELETE FINDLY DEMO AND ALL ITS DATA';

export function authorizeDemo(context) {
  assert.equal(
    context.repository,
    'upc-malvaviscos/findly',
    'Wrong repository',
  );
  assert.equal(context.ref, 'refs/heads/main', 'Only main may operate demo');
  assert.equal(context.event, 'workflow_dispatch', 'Manual dispatch required');
  assert.equal(context.environment, 'demo', 'Only demo is allowed');
  assert(
    demoActors.includes(context.actor),
    'Original actor is not authorized',
  );
  assert(
    demoActors.includes(context.triggeringActor),
    'Rerun actor is not authorized',
  );
  assert(
    ['deploy', 'destroy'].includes(context.operation),
    'Unknown operation',
  );
  if (context.operation === 'destroy')
    assert.equal(
      context.confirmation,
      destroyConfirmation,
      'Explicit data deletion confirmation required',
    );
}

export function demoConfiguration(env) {
  const account = env.FINDLY_AWS_ACCOUNT_ID;
  assert(/^\d{12}$/.test(account ?? ''), 'Reviewed AWS account required');
  assert.equal(env.AWS_REGION, 'eu-west-1', 'Only eu-west-1 is allowed');
  assert.equal(
    env.TF_WORKSPACE,
    'default',
    'Only the default demo workspace is allowed',
  );
  const stateBucket = `findly-terraform-state-${account}`;
  const uploadsBucket = `findly-demo-uploads-${account}-eu-west-1`;
  const webBucket = `findly-demo-web-${account}-eu-west-1`;
  assert.equal(
    env.STATE_BUCKET,
    stateBucket,
    'Shared backend must match the reviewed account',
  );
  assert.equal(
    env.TF_VAR_uploads_bucket_name,
    uploadsBucket,
    'Unexpected uploads bucket',
  );
  assert.equal(env.TF_VAR_web_bucket_name, webBucket, 'Unexpected web bucket');
  assert.equal(
    env.ROLE_ARN,
    `arn:aws:iam::${account}:role/findly-demo-${env.DEMO_OPERATION}`,
    'Unexpected role',
  );
  assert.notEqual(uploadsBucket, stateBucket);
  assert.notEqual(webBucket, stateBucket);
  return {
    account,
    region: 'eu-west-1',
    stateBucket,
    uploadsBucket,
    webBucket,
  };
}

const allowedAddresses = JSON.parse(
  readFileSync(
    new URL('./demo-resource-addresses.json', import.meta.url),
    'utf8',
  ),
);
const indexedAddresses = new Map([
  ['admin_api', ['list_events', 'create_event', 'create_uploads']],
  ['public_enrollment', ['events', 'event', 'register', 'status']],
]);

function validateAddress(resource) {
  const address = resource.address.replace(/\["[a-z_]+"\]$/, '');
  assert(
    allowedAddresses.includes(address),
    `Unexpected managed resource: ${resource.address}`,
  );
  const key = resource.address.match(/\["([a-z_]+)"\]$/)?.[1];
  if (key) {
    const module = resource.address.split('.module.')[1]?.split('.')[0];
    assert(
      indexedAddresses.get(module)?.includes(key),
      'Unexpected indexed resource',
    );
  }
  assert.equal(
    address.split('.').at(-2),
    resource.type,
    'Resource type mismatch',
  );
}

export function validateDestroyPlan(plan, config) {
  assert.equal(plan.errored ?? false, false, 'Terraform plan failed');
  const resources = (plan.resource_changes ?? []).filter(
    (r) => r.mode === 'managed',
  );
  const active = resources;
  for (const resource of active) {
    assert.deepEqual(
      resource.change.actions,
      ['delete'],
      'Destroy plan must contain only deletes',
    );
    validateAddress(resource);
    const value = resource.change.before;
    assert(
      value && resource.change.after === null,
      'Missing destruction inventory',
    );
    const tags = value.tags_all ?? value.tags;
    if (tags && Object.keys(tags).length) {
      assert.equal(tags.Project, 'findly', 'Wrong project');
      assert.equal(tags.Environment, 'demo', 'Wrong environment');
      assert.equal(tags.ManagedBy, 'Terraform', 'Wrong resource owner');
      assert.equal(tags.CostCenter, 'findly', 'Wrong cost center');
    }
    if (value.region) assert.equal(value.region, config.region, 'Wrong region');
    if (value.arn) {
      const parts = value.arn.split(':');
      assert.equal(parts[0], 'arn');
      assert.equal(parts[1], 'aws');
      if (parts[4]) assert.equal(parts[4], config.account, 'Wrong ARN account');
      if (parts[3]) assert.equal(parts[3], config.region, 'Wrong ARN region');
    }
    if (resource.type.startsWith('aws_s3_bucket'))
      assert(
        [config.uploadsBucket, config.webBucket].includes(value.bucket),
        'Unexpected bucket',
      );
    if (resource.type === 'aws_dynamodb_table')
      assert.equal(value.name, 'findly-demo');
    if (resource.type === 'aws_apigatewayv2_api')
      assert.equal(value.name, 'findly-demo-api');
    if (resource.type === 'aws_cognito_user_pool')
      assert.equal(value.name, 'findly-demo-organizers');
    for (const field of ['function_name', 'log_group_name', 'alarm_name']) {
      if (value[field])
        assert(
          /^(\/aws\/lambda\/|arn:aws:lambda:eu-west-1:\d{12}:function:)?findly-demo-/.test(
            value[field],
          ),
          `Wrong ${field}`,
        );
    }
    if (
      [
        'aws_iam_role',
        'aws_sqs_queue',
        'aws_sns_topic',
        'aws_scheduler_schedule',
        'aws_cloudfront_origin_access_control',
      ].includes(resource.type)
    )
      assert(
        value.name?.startsWith('findly-demo-'),
        'Unexpected resource name',
      );
    if (resource.type === 'aws_iam_role')
      assert(
        !['findly-demo-deploy', 'findly-demo-destroy'].includes(value.name),
        'Operational roles are outside the demo stack',
      );
    if (resource.type === 'aws_cloudfront_distribution') {
      assert.equal(value.comment, 'findly-demo');
      assert(
        value.origin?.every((o) =>
          o.domain_name.startsWith(`${config.webBucket}.s3.`),
        ),
        'Unexpected CloudFront origin',
      );
    }
  }
  const values = (type) =>
    active.filter((r) => r.type === type).map((r) => r.change.before);
  const apiIds = values('aws_apigatewayv2_api').map((v) => v.id);
  const pools = values('aws_cognito_user_pool').map((v) => v.id);
  const roles = values('aws_iam_role').map((v) => v.name);
  const functions = values('aws_lambda_function').map((v) => v.function_name);
  const logGroups = values('aws_cloudwatch_log_group').map((v) => v.name);
  for (const resource of active) {
    const v = resource.change.before;
    if (
      resource.type.startsWith('aws_apigatewayv2_') &&
      resource.type !== 'aws_apigatewayv2_api'
    )
      assert(
        apiIds.includes(v.api_id),
        'API child must belong to inventoried demo API',
      );
    if (resource.type === 'aws_cognito_user_pool_client')
      assert(pools.includes(v.user_pool_id), 'Wrong Cognito parent');
    if (resource.type === 'aws_iam_role_policy')
      assert(roles.includes(v.role), 'Wrong IAM parent');
    if (
      resource.type === 'aws_lambda_permission' ||
      resource.type === 'aws_lambda_function_event_invoke_config'
    )
      assert(functions.includes(v.function_name), 'Wrong Lambda parent');
    if (resource.type === 'aws_lambda_event_source_mapping')
      assert(
        values('aws_lambda_function').some((fn) =>
          [fn.function_name, fn.arn].includes(v.function_name),
        ),
        'Wrong Lambda mapping parent',
      );
    if (resource.type === 'aws_cloudwatch_log_metric_filter')
      assert(logGroups.includes(v.log_group_name), 'Wrong log parent');
    if (resource.type === 'aws_sns_topic_policy')
      assert(
        values('aws_sns_topic').some((topic) => topic.arn === v.arn),
        'Wrong SNS parent',
      );
    if (resource.type === 'aws_sqs_queue_policy')
      assert(
        values('aws_sqs_queue').some(
          (queue) => queue.url === v.queue_url || queue.id === v.queue_url,
        ),
        'Wrong queue parent',
      );
  }
  return {
    resources: active.map((r) => ({
      address: r.address,
      type: r.type,
      id: r.change.before.id,
      value: r.change.before,
    })),
    buckets: values('aws_s3_bucket').map((v) => v.bucket),
    functions: values('aws_lambda_function').map((v) => ({
      name: v.function_name,
      timeout: v.timeout,
    })),
    schedules: values('aws_scheduler_schedule').map((v) => ({
      name: v.name,
      group: v.group_name ?? 'default',
    })),
  };
}
