import {
  emitLog,
  resolveCorrelationId,
  type LambdaContextLike,
} from './lib/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'eu-west-1' }),
);
const feedbackSchema = z.object({
  eventType: z.enum(['Bounce', 'Complaint']),
  mail: z.object({
    tags: z.object({
      eventId: z.array(z.string()).min(1),
      operationId: z.array(z.string().uuid()).min(1),
      registrationId: z.array(z.string()).min(1),
    }),
  }),
  bounce: z.object({ bounceType: z.string() }).optional(),
});
async function recordFeedback(event: { Records: Array<{ body: string }> }) {
  for (const record of event.Records) {
    const parsed = feedbackSchema.safeParse(JSON.parse(record.body));
    if (!parsed.success) continue;
    const feedback = parsed.data;
    if (
      feedback.eventType === 'Bounce' &&
      feedback.bounce?.bounceType !== 'Permanent'
    )
      continue;
    const eventId = feedback.mail.tags.eventId[0];
    const operationId = feedback.mail.tags.operationId[0];
    const registrationId = feedback.mail.tags.registrationId[0];
    const field = feedback.eventType === 'Bounce' ? 'bounced' : 'complained';
    try {
      await db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: process.env.FINDLY_TABLE_NAME,
                Key: {
                  PK: `REG#${registrationId}`,
                  SK: `EMAIL#${operationId}`,
                },
                UpdateExpression: 'SET #field = :yes',
                ConditionExpression:
                  'attribute_exists(PK) AND attribute_not_exists(#field)',
                ExpressionAttributeNames: { '#field': field },
                ExpressionAttributeValues: { ':yes': true },
              },
            },
            {
              Update: {
                TableName: process.env.FINDLY_TABLE_NAME,
                Key: { PK: `EVENT#${eventId}`, SK: `EMAIL#${operationId}` },
                UpdateExpression: 'ADD #field :one',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeNames: { '#field': field },
                ExpressionAttributeValues: { ':one': 1 },
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (
        (
          error as {
            name?: string;
            CancellationReasons?: Array<{ Code?: string }>;
          }
        ).name !== 'TransactionCanceledException' ||
        !(
          error as { CancellationReasons?: Array<{ Code?: string }> }
        ).CancellationReasons?.some(
          (reason) => reason.Code === 'ConditionalCheckFailed',
        )
      )
        throw error;
      // Duplicate feedback or erased data: never resurrect the recipient.
    }
  }
}

export async function galleryEmailFeedback(
  event: { Records: Array<{ body: string }> },
  context?: LambdaContextLike,
) {
  const correlationId = resolveCorrelationId(context?.awsRequestId);
  try {
    await recordFeedback(event);
    emitLog('INFO', 'gallery_email_feedback', correlationId, {
      recordCount: event.Records.length,
    });
  } catch {
    emitLog('ERROR', 'gallery_email_feedback_failed', correlationId, {
      errorName: 'GalleryEmailFeedbackFailed',
    });
    throw new Error('GalleryEmailFeedbackFailed');
  }
}
