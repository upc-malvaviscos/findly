import { expect, it } from 'vitest';
import { health } from '../../src/lambdas/health';

it('reports the service health', () => {
  expect(health()).toEqual({
    service: 'findly',
    status: 'ok',
  });
});
