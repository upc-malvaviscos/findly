import assert from 'node:assert/strict';
import {
  requirePermission,
  requireResourcePattern,
  policyDecision,
  validateIdentityPolicy,
} from './iam-policy-evaluation.mjs';
import { flattenResources } from './terraform-permission-inventory.mjs';

const list = (value) => (Array.isArray(value) ? value : [value]);
const requiredTags = [
  'Project',
  'Environment',
  'ManagedBy',
  'CostCenter',
  'DataClass',
];

export function permissionInventory(root, config) {
  const resources = flattenResources(root);
  assert(resources.length, 'Empty Terraform permission inventory');
  const prefix = `findly-production`;
  const arn = (service, path) =>
    `arn:aws:${service}:${config.region}:${config.account}:${path}`;
  const roleArn = (name) => `arn:aws:iam::${config.account}:role/${name}`;
  const functionArn = (name) =>
    name.startsWith('arn:') ? name : arn('lambda', `function:${name}`);
  const boundaryArn = `arn:aws:iam::${config.account}:policy/${prefix}-runtime-boundary`;
  const roles = resources.filter((r) => r.type === 'aws_iam_role');
  const roleNames = new Set(roles.map((r) => r.values.name));
  const functions = resources.filter((r) => r.type === 'aws_lambda_function');
  const queues = resources.filter((r) => r.type === 'aws_sqs_queue');
  const requests = [];
  const runtime = [];
  const byType = (type) => resources.filter((r) => r.type === type);
  for (const resource of resources) {
    const v = resource.values;
    assert(
      v && typeof v === 'object',
      `${resource.address}: unresolved resource values`,
    );
    const tags = { ...(v.tags ?? {}), ...(v.tags_all ?? {}) };
    if (Object.keys(tags).length) {
      assert.equal(
        tags.Project,
        'findly',
        `${resource.address}: foreign Project`,
      );
      assert.equal(
        tags.Environment,
        'production',
        `${resource.address}: foreign Environment`,
      );
      assert.equal(
        tags.ManagedBy,
        'Terraform',
        `${resource.address}: foreign owner`,
      );
      for (const key of requiredTags)
        assert(tags[key], `${resource.address}: missing ${key}`);
    }
    const context = { 'aws:RequestedRegion': config.region };
    for (const [key, value] of Object.entries(tags)) {
      context[`aws:RequestTag/${key}`] = value;
      context[`aws:ResourceTag/${key}`] = value;
    }
    const add = (
      actions,
      target,
      extra = {},
      ownershipSource = resource.address,
    ) => {
      assert.equal(
        typeof target,
        'string',
        `${resource.address}: unresolved permission resource`,
      );
      for (const action of list(actions))
        requests.push({
          source: resource.address,
          ownershipSource,
          action,
          resource: target,
          context: { ...context, ...extra },
        });
    };
    const bucket = () => {
      assert(
        [config.uploadsBucket, config.webBucket].includes(v.bucket),
        `${resource.address}: foreign bucket`,
      );
      return `arn:aws:s3:::${v.bucket}`;
    };
    const queue = () => {
      const found = queues.find((q) => q.values.url === v.queue_url);
      assert(found, `${resource.address}: queue policy has no owned queue`);
      return found.values.arn;
    };
    const api = (child) => {
      assert.match(
        v.api_id,
        /^[a-z0-9]+$/,
        `${resource.address}: unresolved API binding`,
      );
      return `arn:aws:apigateway:${config.region}::/apis/${v.api_id}${child}`;
    };
    switch (resource.type) {
      case 'aws_lambda_function':
        assert(
          v.function_name.startsWith(`${prefix}-`),
          `${resource.address}: foreign function`,
        );
        assert(
          roles.some((r) => r.values.arn === v.role),
          `${resource.address}: unowned execution role`,
        );
        add(
          [
            'lambda:GetFunction',
            'lambda:CreateFunction',
            'lambda:UpdateFunctionCode',
            'lambda:UpdateFunctionConfiguration',
            'lambda:TagResource',
          ],
          functionArn(v.function_name),
        );
        add('iam:PassRole', v.role, {
          'iam:PassedToService': 'lambda.amazonaws.com',
        });
        break;
      case 'aws_iam_role':
        assert(
          v.name.startsWith(`${prefix}-`),
          `${resource.address}: foreign role`,
        );
        assert.equal(
          v.permissions_boundary,
          boundaryArn,
          `${resource.address}: missing runtime boundary`,
        );
        add(
          [
            'iam:GetRole',
            'iam:CreateRole',
            'iam:PutRolePermissionsBoundary',
            'iam:TagRole',
          ],
          roleArn(v.name),
          { 'iam:PermissionsBoundary': boundaryArn },
        );
        break;
      case 'aws_iam_role_policy': {
        assert(
          roleNames.has(v.role),
          `${resource.address}: policy has no inventoried role`,
        );
        assert.equal(
          typeof v.policy,
          'string',
          `${resource.address}: unresolved runtime policy`,
        );
        const policy = JSON.parse(v.policy);
        validateIdentityPolicy(policy);
        runtime.push({ source: resource.address, role: v.role, policy });
        add(['iam:PutRolePolicy', 'iam:GetRolePolicy'], roleArn(v.role));
        break;
      }
      case 'aws_sqs_queue':
        assert(
          v.name.startsWith(`${prefix}-`),
          `${resource.address}: foreign queue`,
        );
        add(
          [
            'sqs:CreateQueue',
            'sqs:SetQueueAttributes',
            'sqs:GetQueueAttributes',
            'sqs:TagQueue',
          ],
          arn('sqs', v.name),
        );
        break;
      case 'aws_sqs_queue_policy':
        add('sqs:SetQueueAttributes', queue());
        break;
      case 'aws_lambda_event_source_mapping': {
        const fn = functionArn(v.function_name);
        assert(
          functions.some((f) => functionArn(f.values.function_name) === fn),
          `${resource.address}: foreign mapping function`,
        );
        assert(
          queues.some((q) => q.values.arn === v.event_source_arn),
          `${resource.address}: foreign mapping queue`,
        );
        assert(
          tags.Project && tags.Environment,
          `${resource.address}: mapping requires explicit ownership tags`,
        );
        add('lambda:CreateEventSourceMapping', '*', {
          'lambda:FunctionArn': fn,
        });
        add(
          'lambda:UpdateEventSourceMapping',
          arn('lambda', 'event-source-mapping:contract'),
          { 'lambda:FunctionArn': fn },
        );
        add('lambda:GetEventSourceMapping', '*');
        add(
          'lambda:TagResource',
          arn('lambda', 'event-source-mapping:contract'),
        );
        break;
      }
      case 'aws_cloudwatch_metric_alarm':
        add(
          [
            'cloudwatch:PutMetricAlarm',
            'cloudwatch:DescribeAlarms',
            'cloudwatch:TagResource',
          ],
          arn('cloudwatch', `alarm:${v.alarm_name}`),
        );
        break;
      case 'aws_cloudwatch_log_group':
        add(
          [
            'logs:CreateLogGroup',
            'logs:PutRetentionPolicy',
            'logs:TagResource',
          ],
          arn('logs', `log-group:${v.name}`),
        );
        break;
      case 'aws_cloudwatch_log_metric_filter':
        add(
          'logs:PutMetricFilter',
          arn('logs', `log-group:${v.log_group_name}`),
        );
        break;
      case 'aws_lambda_permission':
        add('lambda:AddPermission', functionArn(v.function_name));
        break;
      case 'aws_lambda_function_event_invoke_config':
        add(
          'lambda:PutFunctionEventInvokeConfig',
          functionArn(v.function_name),
        );
        break;
      case 'aws_scheduler_schedule': {
        add(
          [
            'scheduler:GetSchedule',
            'scheduler:CreateSchedule',
            'scheduler:UpdateSchedule',
          ],
          arn('scheduler', `schedule/default/${v.name}`),
        );
        assert(
          roles.some((r) => r.values.arn === v.target[0].role_arn),
          `${resource.address}: unowned scheduler role`,
        );
        add('iam:PassRole', v.target[0].role_arn, {
          'iam:PassedToService': 'scheduler.amazonaws.com',
        });
        break;
      }
      case 'aws_s3_bucket':
        add(
          ['s3:CreateBucket', 's3:GetBucketAcl', 's3:PutBucketTagging'],
          bucket(),
        );
        break;
      case 'aws_s3_bucket_cors_configuration':
        add(['s3:GetBucketCORS', 's3:PutBucketCORS'], bucket());
        break;
      case 'aws_s3_bucket_public_access_block':
        add(
          ['s3:GetBucketPublicAccessBlock', 's3:PutBucketPublicAccessBlock'],
          bucket(),
        );
        break;
      case 'aws_s3_bucket_server_side_encryption_configuration':
        add(
          ['s3:GetEncryptionConfiguration', 's3:PutEncryptionConfiguration'],
          bucket(),
        );
        break;
      case 'aws_s3_bucket_policy':
        add(['s3:GetBucketPolicy', 's3:PutBucketPolicy'], bucket());
        break;
      case 'aws_s3_bucket_notification':
        add(['s3:GetBucketNotification', 's3:PutBucketNotification'], bucket());
        break;
      case 'aws_dynamodb_table':
        add(
          [
            'dynamodb:DescribeTable',
            'dynamodb:CreateTable',
            'dynamodb:UpdateTable',
            'dynamodb:UpdateTimeToLive',
            'dynamodb:UpdateContinuousBackups',
            'dynamodb:TagResource',
          ],
          arn('dynamodb', `table/${v.name}`),
        );
        break;
      case 'aws_sns_topic':
        add(
          [
            'sns:GetTopicAttributes',
            'sns:CreateTopic',
            'sns:SetTopicAttributes',
            'sns:TagResource',
          ],
          arn('sns', v.name),
        );
        break;
      case 'aws_sns_topic_policy':
        add('sns:SetTopicAttributes', v.arn);
        break;
      case 'aws_sns_topic_subscription':
        add('sns:Subscribe', v.topic_arn, {
          'sns:Protocol': v.protocol,
          'sns:Endpoint': v.endpoint,
        });
        add('sns:GetSubscriptionAttributes', v.topic_arn);
        break;
      case 'aws_sesv2_configuration_set':
        add(
          [
            'ses:GetConfigurationSet',
            'ses:CreateConfigurationSet',
            'ses:PutConfigurationSetSuppressionOptions',
            'ses:TagResource',
          ],
          arn('ses', `configuration-set/${v.configuration_set_name}`),
        );
        break;
      case 'aws_sesv2_configuration_set_event_destination':
        add(
          [
            'ses:CreateConfigurationSetEventDestination',
            'ses:GetConfigurationSetEventDestinations',
            'ses:UpdateConfigurationSetEventDestination',
          ],
          arn('ses', `configuration-set/${v.configuration_set_name}`),
        );
        break;
      case 'aws_cognito_user_pool':
        add(
          [
            'cognito-idp:CreateUserPool',
            'cognito-idp:DescribeUserPool',
            'cognito-idp:UpdateUserPool',
            'cognito-idp:TagResource',
          ],
          v.arn,
        );
        break;
      case 'aws_cognito_user_pool_client':
        add(
          [
            'cognito-idp:CreateUserPoolClient',
            'cognito-idp:DescribeUserPoolClient',
            'cognito-idp:UpdateUserPoolClient',
          ],
          arn('cognito-idp', `userpool/${v.user_pool_id}`),
          {
            'aws:ResourceTag/Project': 'findly',
            'aws:ResourceTag/Environment': 'production',
          },
          byType('aws_cognito_user_pool').find(
            (pool) => pool.values.id === v.user_pool_id,
          )?.address,
        );
        break;
      case 'aws_apigatewayv2_api':
        add('apigateway:POST', `arn:aws:apigateway:${config.region}::/apis`, {
          'apigateway:Request/ApiName': v.name,
        });
        add(
          'apigateway:GET',
          `arn:aws:apigateway:${config.region}::/apis/${v.id}`,
        );
        break;
      case 'aws_apigatewayv2_authorizer':
        add(
          ['apigateway:GET', 'apigateway:POST', 'apigateway:PATCH'],
          api('/authorizers'),
        );
        break;
      case 'aws_apigatewayv2_integration':
        add(
          ['apigateway:GET', 'apigateway:POST', 'apigateway:PATCH'],
          api('/integrations'),
        );
        break;
      case 'aws_apigatewayv2_route':
        add(
          ['apigateway:GET', 'apigateway:POST', 'apigateway:PATCH'],
          api('/routes'),
        );
        break;
      case 'aws_apigatewayv2_stage':
        add(
          ['apigateway:GET', 'apigateway:POST', 'apigateway:PATCH'],
          api('/stages'),
        );
        break;
      case 'aws_cloudfront_distribution':
        add('cloudfront:CreateDistribution', '*');
        add(
          [
            'cloudfront:GetDistribution',
            'cloudfront:UpdateDistribution',
            'cloudfront:TagResource',
            'cloudfront:CreateInvalidation',
          ],
          v.arn,
        );
        break;
      case 'aws_cloudfront_origin_access_control':
        add('cloudfront:CreateOriginAccessControl', '*');
        add(
          [
            'cloudfront:GetOriginAccessControl',
            'cloudfront:UpdateOriginAccessControl',
          ],
          `arn:aws:cloudfront::${config.account}:origin-access-control/${v.id}`,
        );
        break;
      default:
        throw new Error(
          `${resource.address}: unsupported Terraform resource type ${resource.type}; extend the permission contract`,
        );
    }
  }
  assert.equal(
    new Set(runtime.map((r) => r.role)).size,
    roles.length,
    'Every runtime role needs an inventoried inline policy',
  );
  return {
    version: 1,
    configuration: config,
    resources,
    roles,
    functions,
    queues,
    requests,
    runtime,
    bindings: {
      apiId: byType('aws_apigatewayv2_api')[0]?.values.id,
      oacId: byType('aws_cloudfront_origin_access_control')[0]?.values.id,
    },
  };
}

function requireDenied(policies, request, source, ceiling) {
  assert(
    !(
      policyDecision(policies, request) === 'allowed' &&
      (!ceiling || policyDecision([ceiling], request) === 'allowed')
    ),
    `${source}: unexpected permission outside the isolation contract (${request.action})`,
  );
}

function verifyDeploymentIsolation(inventory, policies, ceiling) {
  const denied = (request, source) =>
    requireDenied(policies, request, source, ceiling);
  const { account, region, stateBucket } = inventory.configuration;
  const foreign = account === '000000000000' ? '999999999999' : '000000000000';
  for (const request of inventory.requests) {
    if (request.resource.includes(account))
      denied(
        { ...request, resource: request.resource.replaceAll(account, foreign) },
        request.source,
      );
    const context = { ...request.context };
    if (request.action === 'iam:CreateRole') {
      delete context['iam:PermissionsBoundary'];
      denied({ ...request, context }, request.source);
      denied(
        { ...request, action: 'iam:DeleteRolePermissionsBoundary' },
        request.source,
      );
    }
    if (request.action === 'iam:PassRole')
      denied(
        {
          ...request,
          context: { ...context, 'iam:PassedToService': 'ec2.amazonaws.com' },
        },
        request.source,
      );
    if (request.action === 'lambda:CreateEventSourceMapping') {
      for (const [key, value] of [
        ['aws:RequestedRegion', 'us-east-1'],
        ['aws:RequestTag/Project', 'foreign'],
        ['aws:RequestTag/Environment', 'demo'],
        [
          'lambda:FunctionArn',
          `arn:aws:lambda:${region}:${account}:function:foreign`,
        ],
      ])
        denied(
          { ...request, context: { ...context, [key]: value } },
          request.source,
        );
      delete context['aws:RequestTag/Project'];
      denied({ ...request, context }, request.source);
    }
    if (
      ['cloudfront:TagResource', 'cognito-idp:TagResource'].includes(
        request.action,
      )
    ) {
      delete context['aws:ResourceTag/Project'];
      delete context['aws:ResourceTag/Environment'];
      denied({ ...request, context }, request.source);
      denied(
        {
          ...request,
          context: {
            ...context,
            'aws:ResourceTag/Project': 'findly',
            'aws:ResourceTag/Environment': 'demo',
          },
        },
        request.source,
      );
    }
  }
  for (const request of [
    {
      action: 'iam:PutRolePolicy',
      resource: `arn:aws:iam::${account}:role/findly-production-deploy`,
    },
    {
      action: 's3:DeleteObject',
      resource: `arn:aws:s3:::${stateBucket}/findly/production/terraform.tfstate`,
    },
  ])
    denied(request, 'protected deployment identity/backend');
}

export function verifyPermissionInventory(
  inventory,
  deployPolicies,
  boundary,
  deployBoundary,
) {
  let runtimeCases = 0;
  for (const request of inventory.requests) {
    requirePermission(deployPolicies, request, request.source);
    if (deployBoundary)
      requirePermission(
        [deployBoundary],
        request,
        `${request.source}: deploy boundary`,
      );
  }
  verifyDeploymentIsolation(inventory, deployPolicies, deployBoundary);
  for (const { source, policy } of inventory.runtime) {
    for (const statement of policy.Statement) {
      assert.equal(
        statement.Effect,
        'Allow',
        `${source}: runtime Deny needs explicit contract support`,
      );
      const context = { 'aws:RequestedRegion': 'eu-west-1' };
      const contextPatterns = {};
      for (const [operator, entries] of Object.entries(
        statement.Condition ?? {},
      ))
        for (const [key, values] of Object.entries(entries)) {
          assert.equal(
            list(values).length,
            1,
            `${source}: multi-valued runtime condition needs contract support`,
          );
          context[key] = list(values)[0];
          if (operator.endsWith('Like')) {
            contextPatterns[key] = list(values)[0];
            context[key] = context[key]
              .replaceAll('*', 'contract')
              .replaceAll('?', 'c');
          }
        }
      for (const action of list(statement.Action)) {
        assert(
          !/[?*]/.test(action),
          `${source}: wildcard runtime action needs contract support`,
        );
        for (const resource of list(statement.Resource)) {
          const request = { action, resource, context, contextPatterns };
          requireResourcePattern(
            [boundary],
            request,
            `${source}: runtime boundary`,
          );
          const account = inventory.configuration.account;
          if (resource.includes(account))
            requireDenied(
              [boundary],
              {
                ...request,
                resource: resource.replaceAll(
                  account,
                  account === '000000000000' ? '999999999999' : '000000000000',
                ),
              },
              `${source}: runtime boundary`,
            );
          if (action === 'dynamodb:BatchWriteItem')
            requireDenied(
              [boundary],
              { ...request, resource: `${resource}/index/GSI1` },
              `${source}: runtime boundary`,
            );
          if (resource.endsWith('-backfill-queue'))
            requireDenied(
              [boundary],
              { ...request, resource: resource.replace(/-queue$/, '-dlq') },
              `${source}: runtime boundary`,
            );
          runtimeCases++;
        }
      }
    }
  }
  return {
    resources: inventory.resources.length,
    deploymentCases: inventory.requests.length,
    runtimeCases,
  };
}
