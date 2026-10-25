import { readFileSync } from 'node:fs';
import { awsCommand } from './lib/aws-command.mjs';
import { authorizeProduction } from './lib/production-controls.mjs';
import { terraformPermissionState } from './lib/terraform-permission-inventory.mjs';
import { mockVariablesForPlan } from './lib/production-plan-inventory.mjs';
import { productionPermissionPreflight } from './lib/production-permission-preflight.mjs';

// Plans can contain sensitive values: read stdin in memory, never log/upload it.
// This adapter exposes only the read-only STS/IAM calls used by the preflight.
authorizeProduction(process.env);
const config = {
  account: process.env.FINDLY_AWS_ACCOUNT_ID,
  region: 'eu-west-1',
  stateBucket: process.env.STATE_BUCKET,
  uploadsBucket: process.env.TF_VAR_uploads_bucket_name,
  webBucket: process.env.TF_VAR_web_bucket_name,
};
const plan = JSON.parse(readFileSync(0, 'utf8'));
const state = terraformPermissionState(
  process.cwd(),
  mockVariablesForPlan(plan, config),
);
const result = productionPermissionPreflight(
  plan,
  state.root_module,
  config,
  awsCommand,
);
console.log(
  `Applied-policy preflight passed: ${result.deploymentCases} deployment cases and ${result.runtimeCases} runtime cases. Local identity-policy subset only: SCP, session/resource policies, concurrent IAM drift and functional AWS acceptance remain outside this result.`,
);
