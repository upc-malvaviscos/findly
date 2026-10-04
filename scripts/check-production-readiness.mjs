import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolveTxt } from 'node:dns/promises';
import { awsCommand as aws } from './lib/aws-command.mjs';
import { requireProductionReadiness } from './lib/production-readiness.mjs';

const config = process.env;
const result = spawnSync(
  'aws',
  [
    'acm',
    'describe-certificate',
    '--region',
    'us-east-1',
    '--certificate-arn',
    config.TF_VAR_web_certificate_arn,
    '--output',
    'json',
    '--no-cli-pager',
  ],
  { encoding: 'utf8' },
);
if (result.status !== 0)
  throw new Error('Unable to verify the reviewed HTTPS certificate');
requireProductionReadiness({
  account: aws('sesv2', 'get-account'),
  identity: aws('sesv2', 'get-email-identity', {
    EmailIdentity: 'findly.barcelona',
  }),
  certificate: JSON.parse(result.stdout).Certificate,
  config,
});
const spf = (await resolveTxt('bounce.findly.barcelona'))
  .map((parts) => parts.join(''))
  .filter((record) => /^v=spf1\b/i.test(record));
assert.deepEqual(
  spf,
  ['v=spf1 include:amazonses.com ~all'],
  'Dedicated MAIL FROM SPF is missing or duplicated',
);
const dmarc = (await resolveTxt('_dmarc.findly.barcelona'))
  .map((parts) => parts.join(''))
  .filter((record) => /^v=DMARC1;/i.test(record));
assert.equal(dmarc.length, 1, 'DMARC is missing or duplicated');
assert(
  /;\s*p=(none|quarantine|reject)(;|$)/.test(dmarc[0]),
  'DMARC policy is invalid',
);
console.log(
  'SES identity, DKIM, MAIL FROM, regional production access and HTTPS certificate verified; delivery and gallery opening still require real tests.',
);
