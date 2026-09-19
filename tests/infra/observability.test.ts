import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Static guard for the spec 12 checklist. CI has no AWS credentials, so this
// reads the Terraform sources; `terraform plan` output is recorded in
// docs/evidence/issue-13-observability-finops.md.
const infraRoot = fileURLToPath(new URL('../../infra', import.meta.url));
const environments = ['sandbox', 'demo', 'production'] as const;

function terraformFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === '.terraform' ? [] : terraformFiles(path);
    return /\.(tf|tfvars)$/.test(entry.name) ? [path] : [];
  });
}

const withoutComments = (source: string) => source.replace(/^\s*#.*$/gm, '');
const read = (relativePath: string) =>
  withoutComments(readFileSync(join(infraRoot, relativePath), 'utf8'));

const sources = terraformFiles(infraRoot).map((path) => ({
  path: path.slice(infraRoot.length + 1).replaceAll('\\', '/'),
  text: withoutComments(readFileSync(path, 'utf8')),
}));

const logGroups = sources.flatMap(({ path, text }) =>
  [
    ...text.matchAll(
      /resource "aws_cloudwatch_log_group" "([^"]+)" \{\n([\s\S]*?)\n\}/g,
    ),
  ].map((match) => ({ path, name: match[1], body: match[2] ?? '' })),
);

describe('CloudWatch log group retention (spec 12)', () => {
  it('finds the log groups declared by the modules', () => {
    // Guards against the regex silently matching nothing after a refactor.
    // Four blocks: admin-api (one for_each block covering three functions),
    // gallery-reader, photo-matching and retention-purger.
    expect(logGroups.length).toBeGreaterThanOrEqual(4);
  });

  it.each(logGroups)('$path: $name sets an explicit retention', ({ body }) => {
    expect(body).toMatch(
      /retention_in_days\s*=\s*(14|var\.log_retention_days)\s*$/m,
    );
  });

  it('defaults every log_retention_days variable to 14 days', () => {
    const declarations = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/variable "log_retention_days" \{([\s\S]*?)\n\}/g)].map(
        (match) => ({ path, body: match[1] ?? '' }),
      ),
    );
    expect(declarations.length).toBeGreaterThanOrEqual(4);
    for (const { body } of declarations)
      expect(body).toMatch(/default\s*=\s*14\b/);
  });

  it('gives every module that creates a Lambda its own log group', () => {
    // A Lambda without a declared group gets an auto-created one that keeps
    // logs forever, which is the cost trap the spec warns about.
    const moduleMains = sources.filter(
      ({ path }) => path.startsWith('modules/') && path.endsWith('/main.tf'),
    );
    const withLambda = moduleMains.filter(({ text }) =>
      text.includes('resource "aws_lambda_function"'),
    );
    expect(withLambda.length).toBeGreaterThanOrEqual(4);
    for (const { path, text } of withLambda)
      expect(text, path).toContain('resource "aws_cloudwatch_log_group"');
  });
});

describe('alerts and budget (spec 12)', () => {
  it('alarms when the photos DLQ holds at least one message', () => {
    const alarm = read('modules/photo-matching/main.tf').match(
      /resource "aws_cloudwatch_metric_alarm" "photos_dlq_has_messages" \{\n([\s\S]*?)\n\}/,
    )?.[1];
    expect(alarm).toBeDefined();
    expect(alarm).toMatch(
      /metric_name\s*=\s*"ApproximateNumberOfMessagesVisible"/,
    );
    expect(alarm).toMatch(/QueueName\s*=\s*aws_sqs_queue\.photos_dlq\.name/);
    expect(alarm).toMatch(
      /comparison_operator\s*=\s*"GreaterThanOrEqualToThreshold"/,
    );
    expect(alarm).toMatch(/threshold\s*=\s*1\s*$/m);
    expect(alarm).toMatch(/alarm_actions\s*=\s*var\.dlq_alarm_actions/);
  });

  it('links the DLQ alarm to the monitoring SNS topic from the shared stack', () => {
    expect(read('modules/findly-stack/main.tf')).toMatch(
      /dlq_alarm_actions\s*=\s*\[module\.monitoring\.alerts_topic_arn\]/,
    );
  });

  it('warns at 80 % of actual spend through the alerts topic', () => {
    const budget = read('modules/monitoring/main.tf').match(
      /resource "aws_budgets_budget" "finops" \{\n([\s\S]*?)\n\}/,
    )?.[1];
    expect(budget).toBeDefined();
    expect(budget).toMatch(/threshold\s*=\s*80\b/);
    expect(budget).toMatch(/threshold_type\s*=\s*"PERCENTAGE"/);
    expect(budget).toMatch(/notification_type\s*=\s*"ACTUAL"/);
    expect(budget).toMatch(
      /subscriber_sns_topic_arns\s*=\s*\[aws_sns_topic\.alerts\.arn\]/,
    );
  });

  it('lets exactly one environment create the account-wide budget', () => {
    // Budgets are account-wide: three environments in one account would
    // otherwise create three identical budgets and send triple alerts.
    // Sandbox owns it (switchable, for identities without Budgets access);
    // demo and production opt out and the shared stack defaults to off.
    expect(read('environments/sandbox/variables.tf')).toMatch(
      /variable "enable_budget"[\s\S]*?default\s*=\s*true/,
    );
    expect(read('environments/sandbox/main.tf')).toMatch(
      /enable_budget\s*=\s*var\.enable_budget/,
    );
    for (const environment of ['demo', 'production'] as const)
      expect(read(`environments/${environment}/main.tf`)).toMatch(
        /enable_budget\s*=\s*false/,
      );
    expect(read('modules/findly-stack/variables.tf')).toMatch(
      /variable "enable_budget"[\s\S]*?default\s*=\s*false/,
    );
  });

  it.each(environments)(
    '%s passes the alert email through to the stack',
    (environment) => {
      expect(read(`environments/${environment}/main.tf`)).toMatch(
        /alert_email\s*=\s*var\.alert_email/,
      );
    },
  );

  it('never commits the alert email: it is a sensitive variable defaulting to null', () => {
    for (const path of [
      'modules/findly-stack/variables.tf',
      'modules/monitoring/variables.tf',
      ...environments.map(
        (environment) => `environments/${environment}/variables.tf`,
      ),
    ]) {
      const declaration = read(path).match(
        /variable "alert_email" \{([\s\S]*?)\n\}/,
      )?.[1];
      expect(declaration, path).toMatch(/default\s*=\s*null/);
      expect(declaration, path).toMatch(/sensitive\s*=\s*true/);
    }
    for (const { path, text } of sources)
      expect(text, path).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  });
});
