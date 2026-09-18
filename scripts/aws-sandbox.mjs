import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const [command] = process.argv.slice(2);
const destroy = command === 'destroy';
const profile = process.env.AWS_PROFILE;
const stateBucket = process.env.FINDLY_TERRAFORM_STATE_BUCKET;
const region = process.env.FINDLY_AWS_REGION ?? 'eu-west-1';
const webPort = process.env.WEB_PORT ?? '5173';
if (!stateBucket) throw new Error('FINDLY_TERRAFORM_STATE_BUCKET is required.');
if (destroy && !process.argv.includes('--confirm'))
  throw new Error('Refusing to destroy the sandbox without --confirm.');

// Use a chosen profile when supplied; otherwise preserve the active AWS
// credential chain, such as a temporary SSO or assumed-role session.
const env = profile
  ? { ...process.env, AWS_PROFILE: profile }
  : { ...process.env };
const commandOutput = (file, args) => {
  const result = spawnSync(file, args, { cwd: 'infra', env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};
const accountId = commandOutput('aws', [
  'sts',
  'get-caller-identity',
  '--query',
  'Account',
  '--output',
  'text',
]);
const variables = [
  `-var=aws_region=${region}`,
  '-var=project=findly',
  '-var=environment=sandbox',
  '-var=cost_center=findly',
  '-var=data_class=synthetic',
  `-var=frontend_domain_url=http://127.0.0.1:${webPort}`,
  `-var=uploads_bucket_name=findly-sandbox-${accountId}-${region}`,
];
commandOutput('terraform', [
  'init',
  '-input=false',
  `-backend-config=bucket=${stateBucket}`,
  '-backend-config=key=findly/sandbox/terraform.tfstate',
  `-backend-config=region=${region}`,
  '-backend-config=encrypt=true',
  '-backend-config=use_lockfile=true',
]);
if (destroy) {
  commandOutput('terraform', ['destroy', '-auto-approve', ...variables]);
  console.log('Destroyed the Findly sandbox.');
  process.exit(0);
}

const npm = (args) => {
  const result = spawnSync('npm', args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
npm(['run', 'build:lambdas']);
npm(['run', 'package:lambdas']);
commandOutput('terraform', ['apply', '-auto-approve', ...variables]);
const outputs = JSON.parse(commandOutput('terraform', ['output', '-json']));
const userName = `local-${randomUUID()}`;
const password = `${randomBytes(24).toString('base64url')}Aa1!`;
const aws = (args) => commandOutput('aws', args);
aws([
  'cognito-idp',
  'admin-create-user',
  '--user-pool-id',
  outputs.cognito_user_pool_id.value,
  '--username',
  userName,
  '--message-action',
  'SUPPRESS',
]);
aws([
  'cognito-idp',
  'admin-set-user-password',
  '--user-pool-id',
  outputs.cognito_user_pool_id.value,
  '--username',
  userName,
  '--password',
  password,
  '--permanent',
]);
console.log(`Organizer username: ${userName}`);
console.log(`Organizer password: ${password}`);
console.log('The credentials are synthetic and exist only in this sandbox.');
const vite = spawn(
  'npm',
  ['exec', 'vite', '--', '--host', '127.0.0.1', '--port', webPort],
  {
    stdio: 'inherit',
    env: {
      ...env,
      VITE_FINDLY_EXECUTION_MODE: 'aws',
      VITE_API_BASE_URL: outputs.api_endpoint.value,
      VITE_COGNITO_USER_POOL_ID: outputs.cognito_user_pool_id.value,
      VITE_COGNITO_CLIENT_ID: outputs.cognito_client_id.value,
      VITE_COGNITO_REGION: region,
    },
  },
);
let userDeleted = false;
const deleteTemporaryUser = () => {
  if (userDeleted) return;
  userDeleted = true;
  try {
    aws([
      'cognito-idp',
      'admin-delete-user',
      '--user-pool-id',
      outputs.cognito_user_pool_id.value,
      '--username',
      userName,
    ]);
  } catch {
    console.error(
      'Could not remove the temporary organizer; run dev:aws-destroy.',
    );
  }
};
const stop = () => vite.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', (code) => {
  deleteTemporaryUser();
  process.exit(code ?? 0);
});
