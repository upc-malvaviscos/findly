import assert from 'node:assert/strict';

export function sharedConfigPolicy(account) {
  assert.match(account, /^\d{12}$/);
  const bucket = `arn:aws:s3:::findly-terraform-state-${account}`;
  const keys = ['email-identity', 'web-certificate'].map(
    (name) => `${bucket}/findly/shared/${name}/terraform.tfstate`,
  );
  return {
    trust: {
      Version: '2012-10-17',
      Statement: [
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
                'repo:upc-malvaviscos/findly:environment:production',
            },
          },
        },
      ],
    },
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'StateMetadata',
          Effect: 'Allow',
          Action: ['s3:GetBucketLocation', 's3:GetBucketVersioning'],
          Resource: bucket,
        },
        {
          Sid: 'StateList',
          Effect: 'Allow',
          Action: 's3:ListBucket',
          Resource: bucket,
          Condition: {
            StringLike: {
              's3:prefix': [
                'findly/shared/email-identity/*',
                'findly/shared/web-certificate/*',
                'env:/',
              ],
            },
          },
        },
        {
          Sid: 'StateReadWrite',
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:PutObject'],
          Resource: keys,
        },
        {
          Sid: 'StateLock',
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          Resource: keys.map((key) => `${key}.tflock`),
        },
        {
          Sid: 'DomainIdentity',
          Effect: 'Allow',
          Action: [
            'ses:CreateEmailIdentity',
            'ses:GetEmailIdentity',
            'ses:PutEmailIdentityMailFromAttributes',
            'ses:TagResource',
            'ses:ListTagsForResource',
          ],
          Resource: `arn:aws:ses:eu-west-1:${account}:identity/findly.barcelona`,
          Condition: { StringEquals: { 'aws:RequestedRegion': 'eu-west-1' } },
        },
        {
          Sid: 'RegionalAccessRequest',
          Effect: 'Allow',
          Action: ['ses:GetAccount', 'ses:PutAccountDetails'],
          Resource: '*',
          Condition: { StringEquals: { 'aws:RequestedRegion': 'eu-west-1' } },
        },
        {
          Sid: 'RequestWebCertificate',
          Effect: 'Allow',
          Action: 'acm:RequestCertificate',
          Resource: '*',
          Condition: {
            'ForAllValues:StringEquals': {
              'acm:DomainNames': ['www.findly.barcelona'],
            },
            StringEquals: {
              'acm:ValidationMethod': 'DNS',
              'aws:RequestedRegion': 'us-east-1',
              'aws:RequestTag/Project': 'findly',
              'aws:RequestTag/Environment': 'shared',
            },
            Null: { 'acm:DomainNames': 'false' },
          },
        },
        {
          Sid: 'ReadSharedCertificate',
          Effect: 'Allow',
          Action: ['acm:DescribeCertificate', 'acm:ListTagsForCertificate'],
          Resource: `arn:aws:acm:us-east-1:${account}:certificate/*`,
          Condition: {
            StringEquals: {
              'aws:ResourceTag/Project': 'findly',
              'aws:ResourceTag/Environment': 'shared',
            },
          },
        },
        {
          Sid: 'TagSharedCertificate',
          Effect: 'Allow',
          Action: 'acm:AddTagsToCertificate',
          Resource: `arn:aws:acm:us-east-1:${account}:certificate/*`,
          Condition: {
            StringEquals: {
              'aws:ResourceTag/Project': 'findly',
              'aws:ResourceTag/Environment': 'shared',
              'aws:RequestTag/Project': 'findly',
              'aws:RequestTag/Environment': 'shared',
            },
          },
        },
      ],
    },
  };
}
