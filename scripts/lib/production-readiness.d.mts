export function requireProductionReadiness(input: {
  account: {
    ProductionAccessEnabled?: boolean;
    SendingEnabled?: boolean;
    EnforcementStatus?: string;
    SendQuota?: { MaxSendRate?: number; Max24HourSend?: number };
  };
  identity: {
    VerifiedForSendingStatus?: boolean;
    DkimAttributes?: { Status?: string; SigningEnabled?: boolean };
    MailFromAttributes?: {
      MailFromDomain?: string;
      MailFromDomainStatus?: string;
      BehaviorOnMxFailure?: string;
    };
  };
  certificate: { Status?: string; DomainName?: string };
  config: Record<string, string | undefined>;
}): void;
