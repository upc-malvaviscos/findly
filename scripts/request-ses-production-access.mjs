import assert from 'node:assert/strict';
import { awsCommand as aws } from './lib/aws-command.mjs';

const identity = aws('sesv2', 'get-email-identity', {
  EmailIdentity: 'findly.barcelona',
});
assert.equal(identity.VerifiedForSendingStatus, true, 'Verify domain first');
assert.equal(identity.DkimAttributes?.Status, 'SUCCESS', 'Verify DKIM first');
assert.equal(
  identity.MailFromAttributes?.MailFromDomainStatus,
  'SUCCESS',
  'Verify MAIL FROM first',
);
assert.equal(
  identity.MailFromAttributes?.BehaviorOnMxFailure,
  'REJECT_MESSAGE',
);
const account = aws('sesv2', 'get-account');
if (account.ProductionAccessEnabled) {
  console.log('SES production access already enabled; no request submitted.');
} else {
  assert.notEqual(
    account.Details?.ReviewDetails?.Status,
    'PENDING',
    'SES request already pending',
  );
  aws('sesv2', 'put-account-details', {
    MailType: 'TRANSACTIONAL',
    WebsiteURL: 'https://www.findly.barcelona',
    ContactLanguage: 'EN',
    ProductionAccessEnabled: true,
    UseCaseDescription:
      'Findly is an academic event photo gallery application. Production website deployment is pending verified email configuration. Source and consent flow are public at https://github.com/upc-malvaviscos/findly. Participants explicitly consent and provide their own email when registering for an event. An authenticated organizer manually requests one individual transactional gallery email for eligible participants of that event. No marketing, purchased lists, bulk campaigns or automatic matching emails. Sender: info@findly.barcelona. DKIM and a dedicated MAIL FROM domain are verified. Planned SES feedback uses SNS and SQS to process permanent bounces and complaints and suppress further delivery; queued work also checks consent, expiry and erasure. Initial sending is limited to two expressly authorized test mailboxes; production sending will remain blocked until deployed feedback and recovery tests pass. Requests are idempotent, workers limit send rate and uncertain send outcomes are not automatically resent.',
  });
  console.log(
    'Transactional SES production access request submitted; AWS approval remains pending.',
  );
}
