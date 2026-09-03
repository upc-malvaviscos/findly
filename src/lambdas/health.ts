export type HealthResponse = {
  readonly service: 'findly';
  readonly status: 'ok';
};

export function health(): HealthResponse {
  return {
    service: 'findly',
    status: 'ok',
  };
}
