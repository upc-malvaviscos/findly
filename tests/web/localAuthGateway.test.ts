import { describe, expect, it } from 'vitest';
import { resolveExecutionMode } from '../../src/web/executionMode';
import {
  createLocalAuthGateway,
  LOCAL_ORGANIZER_PASSWORD,
  LOCAL_ORGANIZER_USERNAME,
} from '../../src/web/localAuthGateway';

describe('local execution authentication', () => {
  it('accepts only the documented synthetic organizer credentials', async () => {
    const gateway = createLocalAuthGateway();
    const session = await gateway.login(
      LOCAL_ORGANIZER_USERNAME,
      LOCAL_ORGANIZER_PASSWORD,
    );
    expect(session.idToken).toBe('local-organizer-token');
    await expect(
      gateway.login(LOCAL_ORGANIZER_USERNAME, 'wrong'),
    ).rejects.toThrow('INVALID_LOCAL_CREDENTIALS');
  });

  it('never enables the mock adapter in a production build', () => {
    expect(resolveExecutionMode(false, 'mock')).toBe('aws');
    expect(resolveExecutionMode(true, 'mock')).toBe('mock');
  });
});
