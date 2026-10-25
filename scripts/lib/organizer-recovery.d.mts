import type { InvitationOptions } from './admin-invitations.mjs';
export declare const recoveryActors: string[];
export declare function recoveryCredentialExpiration(
  value: string | undefined,
): string;
export declare function recoveryTarget(env: NodeJS.ProcessEnv): {
  email: string;
  account: string;
  poolId: string;
};
export declare function recoverOrganizer(
  options: Omit<InvitationOptions, 'send' | 'username'> & { email: string },
): Promise<'invitation' | 'reset-code'>;
export declare function recoveryRoleDocuments(config: {
  account: string;
  poolId: string;
}): { trust: object; policy: object };
