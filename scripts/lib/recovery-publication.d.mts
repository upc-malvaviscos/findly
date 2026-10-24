export declare const recoveryRelease: {
  baseCommit: string;
  recoveryCommit: string;
  authenticationFiles: string[];
  dependencyFiles: string[];
};
export declare const recoveryOrigin: string;
export declare function authorizeRecoveryPublication(
  env: NodeJS.ProcessEnv,
): void;
export declare function publicRecoveryOutputs(
  state: unknown,
): Record<string, string>;
export declare function verifyRecoveryDestinations(
  values: Record<string, string>,
  live: {
    identity: object;
    api: object;
    pool: object;
    client: object;
    distribution: object;
  },
): void;
export declare function assembleRecoverySource(
  repository: string,
  destination: string,
): typeof recoveryRelease & { files: Record<string, string> };
