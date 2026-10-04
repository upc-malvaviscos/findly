import assert from 'node:assert/strict';

export function requireProductionReadiness({
  account,
  identity,
  certificate,
  config,
}) {
  assert.equal(
    account.ProductionAccessEnabled,
    true,
    'SES production access is pending',
  );
  assert.equal(account.SendingEnabled, true, 'SES sending is disabled');
  assert.equal(
    account.EnforcementStatus,
    'HEALTHY',
    'SES enforcement status is not healthy',
  );
  assert(account.SendQuota?.MaxSendRate >= 1, 'Insufficient SES send rate');
  assert(account.SendQuota?.Max24HourSend >= 1, 'Insufficient SES daily quota');
  assert.equal(
    identity.VerifiedForSendingStatus,
    true,
    'SES identity is not verified',
  );
  assert.equal(
    identity.DkimAttributes?.Status,
    'SUCCESS',
    'DKIM verification is pending',
  );
  assert.equal(
    identity.DkimAttributes?.SigningEnabled,
    true,
    'DKIM is disabled',
  );
  assert.equal(
    identity.MailFromAttributes?.MailFromDomain,
    'bounce.findly.barcelona',
  );
  assert.equal(
    identity.MailFromAttributes?.MailFromDomainStatus,
    'SUCCESS',
    'MAIL FROM verification is pending',
  );
  assert.equal(
    identity.MailFromAttributes?.BehaviorOnMxFailure,
    'REJECT_MESSAGE',
  );
  assert.equal(certificate.Status, 'ISSUED', 'HTTPS certificate is pending');
  assert.equal(certificate.DomainName, 'www.findly.barcelona');
  assert.equal(config.TF_VAR_web_domain_name, 'www.findly.barcelona');
  assert.equal(config.TF_VAR_email_from_address, 'info@findly.barcelona');
  assert.equal(
    config.TF_VAR_email_gallery_origin,
    'https://www.findly.barcelona',
  );
  assert.equal(
    config.TF_VAR_email_identity_arn,
    `arn:aws:ses:eu-west-1:${config.FINDLY_AWS_ACCOUNT_ID}:identity/findly.barcelona`,
  );
  assert.match(
    config.TF_VAR_web_certificate_arn ?? '',
    new RegExp(
      `^arn:aws:acm:us-east-1:${config.FINDLY_AWS_ACCOUNT_ID}:certificate/[a-f0-9-]+$`,
    ),
  );
}
