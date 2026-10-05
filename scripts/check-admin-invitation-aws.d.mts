interface CommandSender {
  send(command: { readonly input: object }): Promise<unknown>;
}

export function checkAdminInvitation(options: {
  cognito: CommandSender;
  sts: CommandSender;
  poolId: string;
  clientId: string;
  environment: string;
}): Promise<void>;
