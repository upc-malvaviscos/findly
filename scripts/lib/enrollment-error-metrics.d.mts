export interface EnrollmentErrorSeries {
  id: string;
  metric: 'RegistrationErrors' | 'PollingErrors' | 'ClientEnrollmentErrors';
  stage?: 'registration' | 'upload' | 'polling';
}
export interface MetricDataQuery {
  Id: string;
  ReturnData: boolean;
  MetricStat: {
    Metric: {
      Namespace: string;
      MetricName: string;
      Dimensions?: Array<{ Name: string; Value: string }>;
    };
    Period: number;
    Stat: string;
  };
}
export interface MetricDataResponse {
  MetricDataResults?: Array<{ Id: string; Values?: number[] }>;
}
export type AwsCommand = (
  service: string,
  command: string,
  input: object,
) => MetricDataResponse;
export const ENROLLMENT_ERROR_SERIES: readonly EnrollmentErrorSeries[];
export const SYNTHETIC_CLIENT_REPORTS: ReadonlyArray<{
  stage: 'registration' | 'upload' | 'polling';
  code: string;
}>;
export function enrollmentErrorMetricQuery(
  environment: string,
  startTime: Date,
  endTime: Date,
): {
  StartTime: string;
  EndTime: string;
  ScanBy: string;
  MetricDataQueries: MetricDataQuery[];
};
export function missingEnrollmentErrorSeries(
  response: MetricDataResponse,
): string[];
export function waitForEnrollmentErrorMetrics(options: {
  aws: AwsCommand;
  environment: string;
  startTime: Date;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<void>;
