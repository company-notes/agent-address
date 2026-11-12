import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestData, ResponseData } from '../src/HTTP';

describe('HTTP error reporting never logs untrusted secret-bearing content', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects malformed JSON without logging the raw parser exception or request contents', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const request = new Request('https://address.company-notes.com/v2/account/organization', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"secret":"sensitive-test-value","broken": }',
    });

    await expect(RequestData.readJSON(request)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_json',
    });

    expect(debug.mock.calls, 'The service boundary owns sanitized error logging').toHaveLength(0);
  });

  it('returns an opaque internal error without writing its secret-bearing message to logs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = ResponseData.error(new Error('Never log private-runtime-token-value'));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'internal_error' },
    });

    expect(error.mock.calls, 'Central error logging must report only the exception type')
      .toEqual([['Unexpected API exception:', 'Error']]);
  });
});
