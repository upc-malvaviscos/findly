import { setTimeout as sleep } from 'node:timers/promises';

// ADR-018 / spec 18: the three enrollment stages must be observable in the
// deployed environment. Server-side filters count API failures; the client
// telemetry filter counts what the browser saw, one series per stage.
export const ENROLLMENT_ERROR_SERIES = [
  { id: 'registration_server', metric: 'RegistrationErrors' },
  { id: 'polling_server', metric: 'PollingErrors' },
  ...['registration', 'upload', 'polling'].map((stage) => ({
    id: `client_${stage}`,
    metric: 'ClientEnrollmentErrors',
    stage,
  })),
];

export const SYNTHETIC_CLIENT_REPORTS = [
  { stage: 'registration', code: 'NETWORK_ERROR' },
  { stage: 'upload', code: 'UPLOAD_HTTP_4XX' },
  { stage: 'polling', code: 'UNKNOWN_STATUS' },
];

export function enrollmentErrorMetricQuery(environment, startTime, endTime) {
  return {
    StartTime: startTime.toISOString(),
    EndTime: endTime.toISOString(),
    ScanBy: 'TimestampAscending',
    MetricDataQueries: ENROLLMENT_ERROR_SERIES.map(({ id, metric, stage }) => ({
      Id: id,
      ReturnData: true,
      MetricStat: {
        Metric: {
          Namespace: `Findly/${environment}`,
          MetricName: metric,
          ...(stage && { Dimensions: [{ Name: 'Stage', Value: stage }] }),
        },
        Period: 60,
        Stat: 'Sum',
      },
    })),
  };
}

/** Series ids whose summed datapoints are still below one. */
export function missingEnrollmentErrorSeries(response) {
  const totals = new Map(
    (response.MetricDataResults ?? []).map((result) => [
      result.Id,
      (result.Values ?? []).reduce((sum, value) => sum + value, 0),
    ]),
  );
  return ENROLLMENT_ERROR_SERIES.map(({ id }) => id).filter(
    (id) => (totals.get(id) ?? 0) < 1,
  );
}

/**
 * Polls CloudWatch until every series has at least one datapoint since
 * `startTime`. Metric filters publish with a delay of a few minutes, so the
 * wait is bounded; only series ids are reported, never request data.
 */
export async function waitForEnrollmentErrorMetrics({
  aws,
  environment,
  startTime,
  timeoutMs = 360_000,
  intervalMs = 20_000,
}) {
  const deadline = Date.now() + timeoutMs;
  let missing = ENROLLMENT_ERROR_SERIES.map(({ id }) => id);
  while (Date.now() < deadline) {
    const response = aws(
      'cloudwatch',
      'get-metric-data',
      enrollmentErrorMetricQuery(
        environment,
        startTime,
        new Date(Date.now() + 60_000),
      ),
    );
    missing = missingEnrollmentErrorSeries(response);
    if (missing.length === 0) return;
    await sleep(intervalMs);
  }
  throw new Error(`Enrollment error metrics missing: ${missing.join(', ')}`);
}
