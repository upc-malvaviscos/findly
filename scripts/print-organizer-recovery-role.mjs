import { recoveryRoleDocuments } from './lib/organizer-recovery.mjs';

// Generates reviewed policy documents only; this command never calls AWS.
console.log(
  JSON.stringify(
    recoveryRoleDocuments({
      account: process.env.FINDLY_AWS_ACCOUNT_ID,
      poolId: process.env.FINDLY_COGNITO_USER_POOL_ID,
    }),
    null,
    2,
  ),
);
