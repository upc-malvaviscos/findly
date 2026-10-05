import { createInterface } from 'node:readline';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { STSClient } from '@aws-sdk/client-sts';
import {
  inviteAdministrator,
  invitationRegion,
} from './lib/admin-invitations.mjs';

const args = process.argv.slice(2);
if (
  args.length > 1 ||
  args.some((arg) => !['--send', '--help'].includes(arg))
) {
  console.error(
    'Use invite-admin.mjs [--send]. Enter contact data through stdin only.',
  );
  process.exitCode = 1;
} else if (args.includes('--help')) {
  console.log(
    'Use a temporary non-root AWS session. Set FINDLY_AWS_ACCOUNT_ID and FINDLY_COGNITO_USER_POOL_ID. Run without flags to validate only; --send authorizes one Cognito invitation. Username and email are read from stdin.',
  );
} else {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  const sts = new STSClient({ region: invitationRegion });
  let cognito;
  try {
    process.stderr.write('Administrator username: ');
    const username = (await lines.next()).value;
    process.stderr.write('Administrator email: ');
    const email = (await lines.next()).value;
    const credentials = await sts.config.credentials();
    cognito = new CognitoIdentityProviderClient({
      region: invitationRegion,
      credentials,
      maxAttempts: 1,
    });
    const result = await inviteAdministrator({
      sts,
      cognito,
      credentials,
      account: process.env.FINDLY_AWS_ACCOUNT_ID,
      poolId: process.env.FINDLY_COGNITO_USER_POOL_ID,
      username,
      email,
      send: args.includes('--send'),
    });
    console.log(
      result.sent
        ? 'Cognito accepted the invitation. Delivery is not verified.'
        : 'Production identity and pool validated. No invitation sent.',
    );
  } catch {
    console.error(
      'Unable to complete the invitation safely. Check the temporary non-root session, account, pool configuration and existing user before retrying. No automatic resend is performed.',
    );
    process.exitCode = 1;
  } finally {
    input.close();
    sts.destroy();
    cognito?.destroy();
  }
}
