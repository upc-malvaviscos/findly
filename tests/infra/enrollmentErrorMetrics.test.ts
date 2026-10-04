import { describe, expect, it, vi } from 'vitest';
import {
  ENROLLMENT_ERROR_SERIES,
  enrollmentErrorMetricQuery,
  missingEnrollmentErrorSeries,
  waitForEnrollmentErrorMetrics,
} from '../../scripts/lib/enrollment-error-metrics.mjs';

const allSeries = ENROLLMENT_ERROR_SERIES.map(({ id }) => id);

describe('demo enrollment error metric check (spec 18)', () => {
  it('queries both server metrics and one client series per stage', () => {
    const query = enrollmentErrorMetricQuery(
      'demo',
      new Date('2026-10-04T10:00:00Z'),
      new Date('2026-10-04T10:10:00Z'),
    );
    expect(query.StartTime).toBe('2026-10-04T10:00:00.000Z');
    const metrics = query.MetricDataQueries.map(
      (item) => item.MetricStat.Metric,
    );
    expect(new Set(metrics.map((metric) => metric.Namespace))).toEqual(
      new Set(['Findly/demo']),
    );
    expect(metrics.map((metric) => metric.MetricName)).toEqual([
      'RegistrationErrors',
      'PollingErrors',
      'ClientEnrollmentErrors',
      'ClientEnrollmentErrors',
      'ClientEnrollmentErrors',
    ]);
    expect(metrics.slice(2).map((metric) => metric.Dimensions)).toEqual(
      ['registration', 'upload', 'polling'].map((stage) => [
        { Name: 'Stage', Value: stage },
      ]),
    );
  });

  it('reports the series that have no datapoint yet', () => {
    expect(missingEnrollmentErrorSeries({})).toEqual(allSeries);
    expect(
      missingEnrollmentErrorSeries({
        MetricDataResults: allSeries.map((Id) => ({
          Id,
          Values: Id === 'client_upload' ? [] : [0, 1],
        })),
      }),
    ).toEqual(['client_upload']);
  });

  it('waits until every series is present and fails naming only series ids', async () => {
    const complete = {
      MetricDataResults: allSeries.map((Id) => ({ Id, Values: [1] })),
    };
    const aws = vi.fn().mockReturnValueOnce({}).mockReturnValueOnce(complete);
    await waitForEnrollmentErrorMetrics({
      aws,
      environment: 'demo',
      startTime: new Date(),
      intervalMs: 1,
    });
    expect(aws).toHaveBeenCalledTimes(2);
    expect(aws.mock.calls[0]?.slice(0, 2)).toEqual([
      'cloudwatch',
      'get-metric-data',
    ]);
    await expect(
      waitForEnrollmentErrorMetrics({
        aws: () => ({}),
        environment: 'demo',
        startTime: new Date(),
        timeoutMs: 5,
        intervalMs: 1,
      }),
    ).rejects.toThrow(
      `Enrollment error metrics missing: ${allSeries.join(', ')}`,
    );
  });
});
