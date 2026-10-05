import assert from 'node:assert/strict';

const lifecycleNames = [
  'admin-list_events',
  'admin-create_event',
  'admin-create_uploads',
  'public-events',
  'public-event',
  'public-register',
  'public-status',
  'public-telemetry',
  'gallery-reader',
  'delete-registration',
  'retention-purger',
  'photo-matcher',
  'selfie-indexer',
];

export function demoRolePolicies(config, bindings = {}) {
  return environmentRolePolicies(config, bindings, 'demo');
}

export function productionRolePolicies(config, bindings = {}) {
  const { trust, deploy } = environmentRolePolicies(
    config,
    bindings,
    'production',
  );
  return { trust, deploy };
}

function environmentRolePolicies(config, bindings, environment) {
  const prefix = `findly-${environment}`;
  const names =
    environment === 'production'
      ? [
          ...lifecycleNames,
          'gallery-email-request',
          'gallery-email-status',
          'gallery-email-worker',
          'gallery-email-feedback',
        ]
      : lifecycleNames;
  const tags = {
    Project: 'findly',
    Environment: environment,
    ManagedBy: 'Terraform',
    CostCenter: 'findly',
  };

  const { account, region, stateBucket, uploadsBucket, webBucket } = config;
  assert(/^\d{12}$/.test(account));
  assert.equal(region, 'eu-west-1');
  const aws = (service, resource) =>
    `arn:aws:${service}:${region}:${account}:${resource}`;
  const fnArns = names.map((name) =>
    aws('lambda', `function:${prefix}-${name}`),
  );
  const roleNames = names.map(
    (name) =>
      `${prefix}-${name}${['gallery-reader', 'delete-registration', 'retention-purger', 'photo-matcher'].includes(name) ? '-role' : ''}`,
  );
  roleNames.push(`${prefix}-retention-purger-scheduler-role`);
  const roleArns = roleNames.map(
    (name) => `arn:aws:iam::${account}:role/${name}`,
  );
  const bucketArns = [uploadsBucket, webBucket].map(
    (name) => `arn:aws:s3:::${name}`,
  );
  const requestTags = {
    StringEquals: Object.fromEntries(
      Object.entries(tags).map(([key, value]) => [
        `aws:RequestTag/${key}`,
        value,
      ]),
    ),
  };
  const resourceTags = {
    StringEquals: {
      'aws:ResourceTag/Project': 'findly',
      'aws:ResourceTag/Environment': environment,
    },
  };
  const readRegion = { StringEquals: { 'aws:RequestedRegion': region } };
  const statement = (Action, Resource, Condition) => ({
    Effect: 'Allow',
    Action,
    Resource,
    ...(Condition && { Condition }),
  });
  const document = (Statement) => ({ Version: '2012-10-17', Statement });
  const trust = document([
    {
      Effect: 'Allow',
      Principal: {
        Federated: `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`,
      },
      Action: 'sts:AssumeRoleWithWebIdentity',
      Condition: {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:upc-malvaviscos/findly:environment:${environment}`,
        },
      },
    },
  ]);
  const common = [
    statement(['sts:GetCallerIdentity'], '*'),
    statement(['s3:ListBucket'], `arn:aws:s3:::${stateBucket}`, {
      StringLike: { 's3:prefix': [`findly/${environment}/*`] },
    }),
    statement(
      ['s3:GetObject', 's3:PutObject'],
      `arn:aws:s3:::${stateBucket}/findly/${environment}/terraform.tfstate`,
    ),
    statement(
      ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      `arn:aws:s3:::${stateBucket}/findly/${environment}/terraform.tfstate.tflock`,
    ),
    statement(
      [
        's3:GetBucketVersioning',
        's3:GetEncryptionConfiguration',
        's3:GetBucketPublicAccessBlock',
      ],
      `arn:aws:s3:::${stateBucket}`,
    ),
    {
      Effect: 'Deny',
      Action: ['s3:DeleteBucket', 's3:DeleteObject', 's3:DeleteObjectVersion'],
      Resource: [
        `arn:aws:s3:::${stateBucket}`,
        `arn:aws:s3:::${stateBucket}/findly/${environment}/terraform.tfstate`,
      ],
    },
    {
      Effect: 'Deny',
      Action: [
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:DeleteRole',
        'iam:UpdateAssumeRolePolicy',
      ],
      Resource: [
        `arn:aws:iam::${account}:role/${prefix}-deploy`,
        `arn:aws:iam::${account}:role/${prefix}-destroy`,
      ],
    },
  ];
  const readCore = [
    statement(
      [
        's3:GetBucketLocation',
        // aws_s3_bucket refresh reads these attributes even when unset in HCL.
        's3:GetBucketAcl',
        's3:GetBucketWebsite',
        's3:GetAccelerateConfiguration',
        's3:GetBucketRequestPayment',
        's3:GetBucketLogging',
        's3:GetReplicationConfiguration',
        's3:GetBucketObjectLockConfiguration',
        's3:GetBucketCORS',
        's3:GetEncryptionConfiguration',
        's3:GetBucketPublicAccessBlock',
        's3:GetBucketTagging',
        's3:GetBucketPolicy',
        's3:GetBucketPolicyStatus',
        's3:GetBucketNotification',
        's3:GetBucketVersioning',
        's3:GetLifecycleConfiguration',
        's3:ListBucket',
        's3:ListBucketVersions',
        's3:ListBucketMultipartUploads',
      ],
      bucketArns,
    ),
    statement(
      [
        'dynamodb:DescribeTable',
        'dynamodb:DescribeTimeToLive',
        'dynamodb:DescribeContinuousBackups',
        'dynamodb:ListTagsOfResource',
      ],
      aws('dynamodb', `table/${prefix}`),
    ),
    statement(
      [
        'lambda:GetFunction',
        'lambda:GetFunctionConfiguration',
        'lambda:GetPolicy',
        'lambda:ListTags',
        'lambda:GetFunctionConcurrency',
        'lambda:GetFunctionEventInvokeConfig',
        'lambda:GetFunctionCodeSigningConfig',
        'lambda:ListVersionsByFunction',
      ],
      fnArns,
    ),
    statement(
      [
        'iam:GetRole',
        'iam:GetRolePolicy',
        'iam:ListRolePolicies',
        'iam:ListAttachedRolePolicies',
        'iam:ListInstanceProfilesForRole',
      ],
      roleArns,
    ),
    statement(['logs:DescribeLogGroups'], '*', readRegion),
    statement(
      ['logs:ListTagsForResource', 'logs:DescribeMetricFilters'],
      [
        aws('logs', `log-group:/aws/lambda/${prefix}-*`),
        aws('logs', `log-group:/aws/lambda/${prefix}-*:*`),
      ],
    ),
    statement(
      ['sqs:GetQueueAttributes', 'sqs:GetQueueUrl', 'sqs:ListQueueTags'],
      [
        aws('sqs', `${prefix}-photos-queue`),
        aws('sqs', `${prefix}-photos-dlq`),
      ],
    ),
    statement(
      ['sns:GetTopicAttributes', 'sns:ListTagsForResource'],
      aws('sns', `${prefix}-alerts`),
    ),
    statement(
      ['scheduler:GetSchedule'],
      aws('scheduler', `schedule/default/${prefix}-retention-purger`),
    ),
    statement(
      ['cloudwatch:DescribeAlarms', 'cloudwatch:ListTagsForResource'],
      aws('cloudwatch', `alarm:${prefix}-photos-dlq-has-messages`),
    ),
    statement(['lambda:GetEventSourceMapping'], '*', readRegion),
    statement(
      ['lambda:ListTags'],
      aws('lambda', 'event-source-mapping:*'),
      resourceTags,
    ),
  ];
  const coreDeploy = [
    statement(
      [
        's3:CreateBucket',
        's3:PutBucketCORS',
        's3:PutEncryptionConfiguration',
        's3:PutBucketPublicAccessBlock',
        's3:PutBucketTagging',
        's3:PutBucketPolicy',
        's3:PutBucketNotification',
      ],
      bucketArns,
    ),
    statement(
      ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
      `arn:aws:s3:::${webBucket}/*`,
    ),
    statement(
      [
        'dynamodb:CreateTable',
        'dynamodb:UpdateTable',
        'dynamodb:UpdateTimeToLive',
        'dynamodb:UpdateContinuousBackups',
        'dynamodb:TagResource',
        'dynamodb:UntagResource',
      ],
      aws('dynamodb', `table/${prefix}`),
    ),
    statement(
      [
        'lambda:CreateFunction',
        'lambda:UpdateFunctionCode',
        'lambda:UpdateFunctionConfiguration',
        'lambda:AddPermission',
        'lambda:TagResource',
        'lambda:UntagResource',
        'lambda:PutFunctionEventInvokeConfig',
      ],
      fnArns,
    ),
    statement(
      [
        'iam:CreateRole',
        'iam:TagRole',
        'iam:UntagRole',
        'iam:PutRolePolicy',
        'iam:UpdateAssumeRolePolicy',
      ],
      roleArns,
    ),
    statement(['iam:PassRole'], roleArns, {
      StringEquals: {
        'iam:PassedToService': [
          'lambda.amazonaws.com',
          'scheduler.amazonaws.com',
        ],
      },
    }),
    statement(
      [
        'logs:CreateLogGroup',
        'logs:PutRetentionPolicy',
        'logs:TagResource',
        'logs:UntagResource',
        'logs:PutMetricFilter',
      ],
      [
        aws('logs', `log-group:/aws/lambda/${prefix}-*`),
        aws('logs', `log-group:/aws/lambda/${prefix}-*:*`),
      ],
    ),
    statement(
      [
        'sqs:CreateQueue',
        'sqs:SetQueueAttributes',
        'sqs:TagQueue',
        'sqs:UntagQueue',
      ],
      [
        aws('sqs', `${prefix}-photos-queue`),
        aws('sqs', `${prefix}-photos-dlq`),
      ],
    ),
    statement(
      [
        'sns:CreateTopic',
        'sns:SetTopicAttributes',
        'sns:TagResource',
        'sns:UntagResource',
      ],
      aws('sns', `${prefix}-alerts`),
    ),
    statement(
      ['scheduler:CreateSchedule', 'scheduler:UpdateSchedule'],
      aws('scheduler', `schedule/default/${prefix}-retention-purger`),
    ),
    statement(
      [
        'cloudwatch:PutMetricAlarm',
        'cloudwatch:TagResource',
        'cloudwatch:UntagResource',
      ],
      aws('cloudwatch', `alarm:${prefix}-photos-dlq-has-messages`),
    ),
    statement(['lambda:CreateEventSourceMapping'], '*', {
      StringEquals: {
        'aws:RequestedRegion': region,
        'aws:RequestTag/Project': 'findly',
        'aws:RequestTag/Environment': environment,
      },
      ArnEquals: {
        'lambda:FunctionArn': aws('lambda', `function:${prefix}-photo-matcher`),
      },
    }),
    statement(
      ['lambda:UpdateEventSourceMapping'],
      aws('lambda', 'event-source-mapping:*'),
      {
        ArnEquals: {
          'lambda:FunctionArn': aws(
            'lambda',
            `function:${prefix}-photo-matcher`,
          ),
        },
      },
    ),
    statement(
      ['lambda:TagResource', 'lambda:UntagResource'],
      aws('lambda', 'event-source-mapping:*'),
      resourceTags,
    ),
  ];
  const coreDestroy = [
    statement(
      [
        's3:DeleteBucket',
        's3:PutBucketPolicy',
        's3:DeleteBucketPolicy',
        's3:PutBucketCORS',
        's3:PutEncryptionConfiguration',
        's3:PutBucketPublicAccessBlock',
        's3:DeleteBucketTagging',
        's3:PutBucketNotification',
      ],
      bucketArns,
    ),
    statement(
      ['s3:DeleteObject', 's3:DeleteObjectVersion', 's3:AbortMultipartUpload'],
      bucketArns.map((arn) => `${arn}/*`),
    ),
    statement(['dynamodb:DeleteTable'], aws('dynamodb', `table/${prefix}`)),
    statement(
      [
        'lambda:DeleteFunction',
        'lambda:RemovePermission',
        'lambda:DeleteFunctionEventInvokeConfig',
        'lambda:PutFunctionConcurrency',
      ],
      fnArns,
    ),
    statement(['iam:DeleteRole', 'iam:DeleteRolePolicy'], roleArns),
    statement(['iam:PassRole'], roleArns, {
      StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' },
    }),
    statement(
      ['logs:DeleteLogGroup', 'logs:DeleteMetricFilter'],
      [
        aws('logs', `log-group:/aws/lambda/${prefix}-*`),
        aws('logs', `log-group:/aws/lambda/${prefix}-*:*`),
      ],
    ),
    statement(
      ['sqs:DeleteQueue', 'sqs:SetQueueAttributes'],
      [
        aws('sqs', `${prefix}-photos-queue`),
        aws('sqs', `${prefix}-photos-dlq`),
      ],
    ),
    statement(
      ['sns:DeleteTopic', 'sns:SetTopicAttributes'],
      aws('sns', `${prefix}-alerts`),
    ),
    statement(
      ['scheduler:UpdateSchedule', 'scheduler:DeleteSchedule'],
      aws('scheduler', `schedule/default/${prefix}-retention-purger`),
    ),
    statement(
      ['cloudwatch:DeleteAlarms'],
      aws('cloudwatch', `alarm:${prefix}-photos-dlq-has-messages`),
    ),
    statement(
      ['lambda:DeleteEventSourceMapping'],
      aws('lambda', 'event-source-mapping:*'),
      {
        ArnEquals: {
          'lambda:FunctionArn': aws(
            'lambda',
            `function:${prefix}-photo-matcher`,
          ),
        },
      },
    ),
    statement(['rekognition:ListCollections'], '*', readRegion),
    statement(
      [
        'rekognition:ListTagsForResource',
        'rekognition:DeleteCollection',
        'rekognition:DescribeCollection',
      ],
      aws('rekognition', `collection/${prefix}-event-*`),
    ),
  ];
  const distributionArn = `arn:aws:cloudfront::${account}:distribution/*`;
  const edgeRead = [
    statement(
      [
        'cloudfront:GetDistribution',
        'cloudfront:GetDistributionConfig',
        'cloudfront:ListTagsForResource',
        'cloudfront:GetInvalidation',
      ],
      distributionArn,
      resourceTags,
    ),
    statement(
      [
        'cloudfront:GetOriginAccessControl',
        'cloudfront:GetOriginAccessControlConfig',
      ],
      `arn:aws:cloudfront::${account}:origin-access-control/*`,
    ),
    statement(
      [
        'cognito-idp:DescribeUserPool',
        'cognito-idp:GetUserPoolMfaConfig',
        'cognito-idp:DescribeUserPoolClient',
        'cognito-idp:ListUserPoolClients',
        'cognito-idp:ListTagsForResource',
      ],
      aws('cognito-idp', 'userpool/*'),
      resourceTags,
    ),
    statement(
      ['apigateway:GET'],
      `arn:aws:apigateway:${region}::/apis/*`,
      resourceTags,
    ),
  ];
  const edgeDeploy = [
    statement(
      environment === 'production'
        ? ['cloudfront:CreateDistribution']
        : ['cloudfront:CreateDistribution', 'cloudfront:TagResource'],
      environment === 'production' ? '*' : distributionArn,
      requestTags,
    ),
    statement(
      [
        'cloudfront:UpdateDistribution',
        'cloudfront:CreateInvalidation',
        'cloudfront:TagResource',
        'cloudfront:UntagResource',
      ],
      distributionArn,
      resourceTags,
    ),
    statement(['cloudfront:CreateOriginAccessControl'], '*'),
    statement(
      environment === 'production'
        ? ['cognito-idp:CreateUserPool']
        : ['cognito-idp:CreateUserPool', 'cognito-idp:TagResource'],
      aws('cognito-idp', 'userpool/*'),
      requestTags,
    ),
    statement(
      [
        'cognito-idp:CreateUserPoolClient',
        'cognito-idp:UpdateUserPool',
        'cognito-idp:UpdateUserPoolClient',
        'cognito-idp:TagResource',
        'cognito-idp:UntagResource',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminDeleteUser',
      ],
      aws('cognito-idp', 'userpool/*'),
      resourceTags,
    ),
    // The demo smoke reads the enrollment error metrics it induces (ADR-018).
    // GetMetricData has no resource-level scoping; it is read-only.
    statement(['cloudwatch:GetMetricData'], '*', readRegion),
    statement(['apigateway:POST'], `arn:aws:apigateway:${region}::/apis`, {
      ...requestTags,
      StringEquals: {
        ...requestTags.StringEquals,
        'apigateway:Request/ApiName': `${prefix}-api`,
      },
    }),
    // CreateApi authorizes its initial tags separately, without ApiName context.
    // Demo retains its approved tagging exception. Production requires prior
    // ownership, even if that causes tag-on-create to fail closed.
    statement(
      ['apigateway:POST'],
      `arn:aws:apigateway:${region}::/tags/arn%3Aaws%3Aapigateway%3A${region}%3A%3A%2Fv2%2Fapis%2F*`,
      {
        StringEquals: {
          ...requestTags.StringEquals,
          ...(environment === 'production' && resourceTags.StringEquals),
          'aws:RequestedRegion': region,
        },
      },
    ),
  ];
  const edgeDestroy = [
    statement(
      ['cloudfront:UpdateDistribution', 'cloudfront:DeleteDistribution'],
      distributionArn,
      resourceTags,
    ),
    statement(
      ['cognito-idp:DeleteUserPool', 'cognito-idp:DeleteUserPoolClient'],
      aws('cognito-idp', 'userpool/*'),
      resourceTags,
    ),
    statement(
      ['apigateway:DELETE'],
      `arn:aws:apigateway:${region}::/apis/*`,
      resourceTags,
    ),
  ];
  if (bindings.apiId) {
    assert(/^[a-z0-9]+$/.test(bindings.apiId));
    const resources = [
      `arn:aws:apigateway:${region}::/apis/${bindings.apiId}`,
      `arn:aws:apigateway:${region}::/apis/${bindings.apiId}/*`,
      `arn:aws:apigateway:${region}::/tags/arn%3Aaws%3Aapigateway%3A${region}%3A%3A%2Fapis%2F${bindings.apiId}*`,
      `arn:aws:apigateway:${region}::/tags/arn%3Aaws%3Aapigateway%3A${region}%3A%3A%2Fv2%2Fapis%2F${bindings.apiId}*`,
    ];
    edgeRead.push(statement(['apigateway:GET'], resources));
    edgeDeploy.push(
      statement(
        ['apigateway:POST', 'apigateway:PATCH', 'apigateway:PUT'],
        resources,
      ),
    );
    if (environment === 'production') {
      // V2 tag-on-create checks an internal action absent from the IAM catalog.
      // The approved exception covers only this API's stage collection.
      edgeDeploy.push(
        statement(
          ['apigateway:*'],
          `arn:aws:apigateway:${region}::/apis/${bindings.apiId}/stages`,
          {
            StringEquals: {
              ...requestTags.StringEquals,
              'aws:RequestedRegion': region,
            },
          },
        ),
      );
    }
    edgeDestroy.push(statement(['apigateway:DELETE'], resources));
  }
  if (bindings.oacId) {
    assert(/^[A-Z0-9]+$/.test(bindings.oacId));
    const arn = `arn:aws:cloudfront::${account}:origin-access-control/${bindings.oacId}`;
    edgeDeploy.push(statement(['cloudfront:UpdateOriginAccessControl'], arn));
    edgeDestroy.push(statement(['cloudfront:DeleteOriginAccessControl'], arn));
  }
  if (bindings.distributionId) {
    assert(/^[A-Z0-9]+$/.test(bindings.distributionId));
    edgeRead.push(
      statement(
        [
          'cloudfront:GetDistribution',
          'cloudfront:GetDistributionConfig',
          'cloudfront:ListTagsForResource',
          'cloudfront:GetInvalidation',
        ],
        `arn:aws:cloudfront::${account}:distribution/${bindings.distributionId}`,
      ),
    );
  }
  if (bindings.poolId) {
    assert(/^eu-west-1_[A-Za-z0-9]+$/.test(bindings.poolId));
    edgeRead.push(
      statement(
        [
          'cognito-idp:DescribeUserPool',
          'cognito-idp:DescribeUserPoolClient',
          'cognito-idp:ListUserPoolClients',
          'cognito-idp:ListTagsForResource',
        ],
        aws('cognito-idp', `userpool/${bindings.poolId}`),
      ),
    );
  }
  const result = {
    trust,
    deploy: {
      core: document([...common, ...readCore, ...coreDeploy]),
      edge: document([...edgeRead, ...edgeDeploy]),
    },
    destroy: {
      core: document([...common, ...readCore, ...coreDestroy]),
      edge: document([...edgeRead, ...edgeDestroy]),
    },
  };
  return result;
}

export function partitionManagedPolicies(documents) {
  const parts = [];
  let statements = [];
  for (const document of Object.values(documents)) {
    for (const statement of document.Statement) {
      const candidate = {
        Version: '2012-10-17',
        Statement: [...statements, statement],
      };
      if (JSON.stringify(candidate).length > 6000) {
        assert(
          statements.length,
          'One statement exceeds the managed policy limit',
        );
        parts.push({ Version: '2012-10-17', Statement: statements });
        statements = [];
      }
      statements.push(statement);
    }
  }
  if (statements.length)
    parts.push({ Version: '2012-10-17', Statement: statements });
  assert(parts.every((p) => JSON.stringify(p).length <= 6000));
  assert(parts.length <= 10, 'Role attachment limit exceeded');
  return parts;
}
