import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { STSClient } from '@aws-sdk/client-sts';
import { recoveryTarget, recoverOrganizer } from './lib/organizer-recovery.mjs';

let sts;
let cognito;
try {
  if (process.argv.slice(2).some((arg) => arg !== '--check'))
    throw new Error('Invalid arguments.');
  const target = recoveryTarget(process.env);
  if (process.argv.includes('--check')) {
    console.log(
      'Recovery actor and private account mapping validated; no AWS request made.',
    );
  } else {
    sts = new STSClient({ region: 'eu-west-1' });
    const credentials = await sts.config.credentials();
    cognito = new CognitoIdentityProviderClient({
      region: 'eu-west-1',
      credentials,
      maxAttempts: 1,
    });
    const result = await recoverOrganizer({
      ...target,
      sts,
      cognito,
      credentials,
    });
    console.log(
      result === 'invitation'
        ? 'Cognito accepted a new temporary-password invitation to your registered email. Sign in and choose your password.'
        : 'Cognito accepted a reset-code request to your verified email. Open the login page and choose “Ya tengo un código de recuperación”.',
    );
    console.log('https://www.findly.barcelona/admin/login');
    console.log('Delivery is not confirmed by the API response.');
  }
} catch {
  console.error(
    'Recovery was not confirmed. Check actor mapping, temporary role, pool, account status and verified email. Inspect Cognito before retrying; no automatic resend is performed.',
  );
  process.exitCode = 1;
} finally {
  sts?.destroy();
  cognito?.destroy();
}
