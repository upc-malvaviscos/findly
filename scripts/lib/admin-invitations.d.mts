import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { STSClient } from '@aws-sdk/client-sts';

export declare const invitationRegion: 'eu-west-1';

export type InvitationInput = {
  account?: string;
  poolId?: string;
  username?: string;
  email?: string;
};

export declare function validateInvitationInput(input: InvitationInput): void;

export type InvitationOptions = InvitationInput & {
  sts: Pick<STSClient, 'send'>;
  cognito: Pick<CognitoIdentityProviderClient, 'send'>;
  credentials: {
    sessionToken?: string;
    expiration?: Date;
  };
  send?: boolean;
  now?: number;
};

export declare function inviteAdministrator(
  options: InvitationOptions,
): Promise<{ sent: boolean }>;
