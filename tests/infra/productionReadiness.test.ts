import { describe, expect, it } from 'vitest';
import { requireProductionReadiness } from '../../scripts/lib/production-readiness.mjs';

const valid = {
  account: {
    ProductionAccessEnabled: true,
    SendingEnabled: true,
    EnforcementStatus: 'HEALTHY',
    SendQuota: { MaxSendRate: 1, Max24HourSend: 200 },
  },
  identity: {
    VerifiedForSendingStatus: true,
    DkimAttributes: { Status: 'SUCCESS', SigningEnabled: true },
    MailFromAttributes: {
      MailFromDomain: 'bounce.findly.barcelona',
      MailFromDomainStatus: 'SUCCESS',
      BehaviorOnMxFailure: 'REJECT_MESSAGE',
    },
  },
  certificate: { Status: 'ISSUED', DomainName: 'www.findly.barcelona' },
  config: {
    FINDLY_AWS_ACCOUNT_ID: '123456789012',
    TF_VAR_web_domain_name: 'www.findly.barcelona',
    TF_VAR_email_from_address: 'info@findly.barcelona',
    TF_VAR_email_gallery_origin: 'https://www.findly.barcelona',
    TF_VAR_email_identity_arn:
      'arn:aws:ses:eu-west-1:123456789012:identity/findly.barcelona',
    TF_VAR_web_certificate_arn:
      'arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000',
  },
};

describe('production email and HTTPS readiness', () => {
  const disabled = {
    certificate: valid.certificate,
    config: {
      ...valid.config,
      ENABLE_PRODUCTION_EMAIL: 'false',
      TF_VAR_email_identity_arn: '',
      TF_VAR_email_from_address: '',
    },
  };
  it('allows the approved HTTPS deployment without SES credentials or mailbox DNS readiness', () => {
    expect(() => requireProductionReadiness(disabled)).not.toThrow();
  });
  it.each([
    { Status: 'PENDING_VALIDATION' },
    { DomainName: 'foreign.example' },
  ])(
    'requires the approved issued certificate even with email disabled: %j',
    (certificate) => {
      expect(() =>
        requireProductionReadiness({
          ...disabled,
          certificate: { ...disabled.certificate, ...certificate },
        }),
      ).toThrow();
    },
  );
  it('rejects a foreign web domain when email is disabled', () => {
    expect(() =>
      requireProductionReadiness({
        ...disabled,
        config: {
          ...disabled.config,
          TF_VAR_web_domain_name: 'foreign.example',
        },
      }),
    ).toThrow();
  });
  it.each([
    { TF_VAR_email_identity_arn: valid.config.TF_VAR_email_identity_arn },
    { TF_VAR_email_from_address: valid.config.TF_VAR_email_from_address },
  ])(
    'rejects email resources accidentally configured in disabled mode: %j',
    (changes) => {
      expect(() =>
        requireProductionReadiness({
          ...disabled,
          config: { ...disabled.config, ...changes },
        }),
      ).toThrow();
    },
  );
  it('never downgrades explicit email enablement when its configuration is missing', () => {
    expect(() =>
      requireProductionReadiness({
        ...disabled,
        config: { ...disabled.config, ENABLE_PRODUCTION_EMAIL: 'true' },
      }),
    ).toThrow();
  });
  it('retains every SES gate after explicit email enablement', () => {
    expect(() =>
      requireProductionReadiness({
        ...valid,
        account: { ...valid.account, ProductionAccessEnabled: false },
        config: { ...valid.config, ENABLE_PRODUCTION_EMAIL: 'true' },
      }),
    ).toThrow();
  });
  it('accepts verified regional email and the approved certificate', () => {
    expect(() => requireProductionReadiness(valid)).not.toThrow();
  });
  it.each([
    { ProductionAccessEnabled: false },
    { SendingEnabled: false },
    { EnforcementStatus: 'SHUTDOWN' },
    { SendQuota: { MaxSendRate: 0, Max24HourSend: 200 } },
    { SendQuota: { MaxSendRate: 1, Max24HourSend: 0 } },
  ])('blocks unusable SES account: %j', (changes) => {
    expect(() =>
      requireProductionReadiness({
        ...valid,
        account: { ...valid.account, ...changes },
      }),
    ).toThrow();
  });
  it('blocks incomplete authentication even if the identity itself is verified', () => {
    for (const status of ['PENDING', 'FAILED']) {
      expect(() =>
        requireProductionReadiness({
          ...valid,
          identity: {
            ...valid.identity,
            DkimAttributes: { Status: status, SigningEnabled: true },
          },
        }),
      ).toThrow();
      expect(() =>
        requireProductionReadiness({
          ...valid,
          identity: {
            ...valid.identity,
            MailFromAttributes: {
              ...valid.identity.MailFromAttributes,
              MailFromDomainStatus: status,
            },
          },
        }),
      ).toThrow();
    }
    expect(() =>
      requireProductionReadiness({
        ...valid,
        identity: { ...valid.identity, VerifiedForSendingStatus: false },
      }),
    ).toThrow();
    expect(() =>
      requireProductionReadiness({
        ...valid,
        identity: {
          ...valid.identity,
          DkimAttributes: { Status: 'SUCCESS', SigningEnabled: false },
        },
      }),
    ).toThrow();
  });
  it.each([
    { Status: 'PENDING_VALIDATION' },
    { DomainName: 'findly.barcelona' },
  ])('blocks the wrong certificate: %j', (changes) => {
    expect(() =>
      requireProductionReadiness({
        ...valid,
        certificate: { ...valid.certificate, ...changes },
      }),
    ).toThrow();
  });
  it.each([
    { TF_VAR_email_gallery_origin: 'https://foreign.example' },
    { TF_VAR_email_gallery_origin: 'http://www.findly.barcelona' },
    { TF_VAR_email_from_address: 'other@findly.barcelona' },
    {
      TF_VAR_email_identity_arn:
        'arn:aws:ses:eu-west-1:000000000000:identity/findly.barcelona',
    },
    {
      TF_VAR_web_certificate_arn:
        'arn:aws:acm:eu-west-1:123456789012:certificate/00000000',
    },
  ])('rejects unintended external configuration: %j', (changes) => {
    expect(() =>
      requireProductionReadiness({
        ...valid,
        config: { ...valid.config, ...changes },
      }),
    ).toThrow();
  });
});
