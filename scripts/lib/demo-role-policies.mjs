import assert from 'node:assert/strict';

const tags = {
  Project: 'findly',
  Environment: 'demo',
  ManagedBy: 'Terraform',
  CostCenter: 'findly',
};
const lifecycleNames = [
  'admin-list_events',
  'admin-create_event',
  'admin-create_uploads',
  'public-events',
  'public-event',
  'public-register',
  'public-status',
  'gallery-reader',
  'delete-registration',
  'retention-purger',
  'photo-matcher',
  'selfie-indexer',
];

export function demoRolePolicies(config, bindings = {}) {
  const { account, region, stateBucket, uploadsBucket, webBucket } = config;
  assert(/^\d{12}$/.test(account));
  assert.equal(region, 'eu-west-1');
  const aws = (service, resource) =>
    `arn:aws:${service}:${region}:${account}:${resource}`;
  const fnArns = lifecycleNames.map((name) =>
    aws('lambda', `function:findly-demo-${name}`),
  );
  const roleNames = lifecycleNames.map(
    (name) =>
      `findly-demo-${name}${['gallery-reader', 'delete-registration', 'retention-purger', 'photo-matcher'].includes(name) ? '-role' : ''}`,
  );
  roleNames.push('findly-demo-retention-purger-scheduler-role');
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
      'aws:ResourceTag/Environment': 'demo',
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
          'token.actions.githubusercontent.com:sub':
            'repo:upc-malvaviscos/findly:environment:demo',
        },
      },
    },
  ]);
  const common = [
    statement(['sts:GetCallerIdentity'], '*'),
    statement(['s3:ListBucket'], `arn:aws:s3:::${stateBucket}`, {
      StringLike: { 's3:prefix': ['findly/demo/*'] },
    }),
    statement(
      ['s3:GetObject', 's3:PutObject'],
      `arn:aws:s3:::${stateBucket}/findly/demo/terraform.tfstate`,
    ),
    statement(
      ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      `arn:aws:s3:::${stateBucket}/findly/demo/terraform.tfstate.tflock`,
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
        `arn:aws:s3:::${stateBucket}/findly/demo/terraform.tfstate`,
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
        `arn:aws:iam::${account}:role/findly-demo-deploy`,
        `arn:aws:iam::${account}:role/findly-demo-destroy`,
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
      aws('dynamodb', 'table/findly-demo'),
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
        aws('logs', 'log-group:/aws/lambda/findly-demo-*'),
        aws('logs', 'log-group:/aws/lambda/findly-demo-*:*'),
      ],
    ),
    statement(
      ['sqs:GetQueueAttributes', 'sqs:GetQueueUrl', 'sqs:ListQueueTags'],
      [
        aws('sqs', 'findly-demo-photos-queue'),
        aws('sqs', 'findly-demo-photos-dlq'),
      ],
    ),
    statement(
      ['sns:GetTopicAttributes', 'sns:ListTagsForResource'],
      aws('sns', 'findly-demo-alerts'),
    ),
    statement(
      ['scheduler:GetSchedule'],
      aws('scheduler', 'schedule/default/findly-demo-retention-purger'),
    ),
    statement(
      ['cloudwatch:DescribeAlarms', 'cloudwatch:ListTagsForResource'],
      aws('cloudwatch', 'alarm:findly-demo-photos-dlq-has-messages'),
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
      aws('dynamodb', 'table/findly-demo'),
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
        aws('logs', 'log-group:/aws/lambda/findly-demo-*'),
        aws('logs', 'log-group:/aws/lambda/findly-demo-*:*'),
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
        aws('sqs', 'findly-demo-photos-queue'),
        aws('sqs', 'findly-demo-photos-dlq'),
      ],
    ),
    statement(
      [
        'sns:CreateTopic',
        'sns:SetTopicAttributes',
        'sns:TagResource',
        'sns:UntagResource',
      ],
      aws('sns', 'findly-demo-alerts'),
    ),
    statement(
      ['scheduler:CreateSchedule', 'scheduler:UpdateSchedule'],
      aws('scheduler', 'schedule/default/findly-demo-retention-purger'),
    ),
    statement(
      [
        'cloudwatch:PutMetricAlarm',
        'cloudwatch:TagResource',
        'cloudwatch:UntagResource',
      ],
      aws('cloudwatch', 'alarm:findly-demo-photos-dlq-has-messages'),
    ),
    statement(['lambda:CreateEventSourceMapping'], '*', {
      StringEquals: {
        'aws:RequestedRegion': region,
        'aws:RequestTag/Project': 'findly',
        'aws:RequestTag/Environment': 'demo',
      },
      ArnEquals: {
        'lambda:FunctionArn': aws(
          'lambda',
          'function:findly-demo-photo-matcher',
        ),
      },
    }),
    statement(
      ['lambda:UpdateEventSourceMapping'],
      aws('lambda', 'event-source-mapping:*'),
      {
        ArnEquals: {
          'lambda:FunctionArn': aws(
            'lambda',
            'function:findly-demo-photo-matcher',
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
    statement(['dynamodb:DeleteTable'], aws('dynamodb', 'table/findly-demo')),
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
        aws('logs', 'log-group:/aws/lambda/findly-demo-*'),
        aws('logs', 'log-group:/aws/lambda/findly-demo-*:*'),
      ],
    ),
    statement(
      ['sqs:DeleteQueue', 'sqs:SetQueueAttributes'],
      [
        aws('sqs', 'findly-demo-photos-queue'),
        aws('sqs', 'findly-demo-photos-dlq'),
      ],
    ),
    statement(
      ['sns:DeleteTopic', 'sns:SetTopicAttributes'],
      aws('sns', 'findly-demo-alerts'),
    ),
    statement(
      ['scheduler:UpdateSchedule', 'scheduler:DeleteSchedule'],
      aws('scheduler', 'schedule/default/findly-demo-retention-purger'),
    ),
    statement(
      ['cloudwatch:DeleteAlarms'],
      aws('cloudwatch', 'alarm:findly-demo-photos-dlq-has-messages'),
    ),
    statement(
      ['lambda:DeleteEventSourceMapping'],
      aws('lambda', 'event-source-mapping:*'),
      {
        ArnEquals: {
          'lambda:FunctionArn': aws(
            'lambda',
            'function:findly-demo-photo-matcher',
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
      aws('rekognition', 'collection/findly-demo-event-*'),
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
      ['cloudfront:CreateDistribution', 'cloudfront:TagResource'],
      distributionArn,
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
      ['cognito-idp:CreateUserPool', 'cognito-idp:TagResource'],
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
    statement(['apigateway:POST'], `arn:aws:apigateway:${region}::/apis`, {
      ...requestTags,
      StringEquals: {
        ...requestTags.StringEquals,
        'apigateway:Request/ApiName': 'findly-demo-api',
      },
    }),
    // CreateApi authorizes its initial tags separately, without ApiName context.
    // Approved option 2 permits demo-tagged APIs in this region at that step.
    statement(
      ['apigateway:POST'],
      `arn:aws:apigateway:${region}::/tags/arn%3Aaws%3Aapigateway%3A${region}%3A%3A%2Fv2%2Fapis%2F*`,
      {
        StringEquals: {
          ...requestTags.StringEquals,
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
    // CreateStage separately checks TagResource on the exact API's stages path.
    edgeDeploy.push(
      statement(
        ['apigateway:TagResource'],
        `arn:aws:apigateway:${region}::/apis/${bindings.apiId}/stages`,
        {
          StringEquals: {
            ...requestTags.StringEquals,
            'aws:RequestedRegion': region,
          },
        },
      ),
    );
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
