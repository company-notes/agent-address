import { ApplicationError } from './ApplicationError';

export type JSONRecord = Record<string, unknown>;

export class RequestData {
  static bearerToken(request: Request, errorMessage = 'Bearer token required.'): string {
    const authorization = request.headers.get('authorization') ?? '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      throw new ApplicationError(401, 'unauthorized', errorMessage);
    }

    return match[1].trim();
  }

  static async readJSON(request: Request): Promise<JSONRecord> {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new ApplicationError(415, 'unsupported_media_type', 'Use application/json.');
    }

    let data: unknown;
    try {
      data = await request.json();
    } catch {
      // The API error boundary reports only the sanitized error code.
      throw new ApplicationError(400, 'invalid_json', 'Request body must be a JSON object.');
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ApplicationError(400, 'invalid_json', 'Request body must be a JSON object.');
    }

    return data as JSONRecord;
  }

  static organizationChanges(data: JSONRecord): { slug?: string; displayName?: string } {
    if (!('slug' in data) && !('displayName' in data)) {
      throw new ApplicationError(400, 'invalid_request', 'Provide a slug or display name.');
    }

    return {
      ...('slug' in data ? { slug: this.requiredString(data, 'slug', 63) } : {}),
      ...('displayName' in data ? { displayName: this.requiredString(data, 'displayName', 120) } : {}),
    };
  }

  static requiredString(data: JSONRecord, key: string, maxLength = 128): string {
    const value = data[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new ApplicationError(400, 'invalid_request', `${key} is required.`);
    }

    const result = value.trim();
    if (result.length > maxLength) {
      throw new ApplicationError(400, 'invalid_request', `${key} is too long.`);
    }

    return result;
  }

  static optionalString(data: JSONRecord, key: string, maxLength = 128): string | null {
    const value = data[key];
    if (value == null || value === '') {
      return null;
    }
    if (typeof value !== 'string') {
      throw new ApplicationError(400, 'invalid_request', `${key} must be a string.`);
    }

    const result = value.trim();
    if (result.length > maxLength) {
      throw new ApplicationError(400, 'invalid_request', `${key} is too long.`);
    }

    return result || null;
  }
}

export class ResponseData {
  static json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...extraHeaders,
      },
    });
  }

  static ok(data: unknown, status = 200): Response {
    return this.json({ ok: true, data }, status);
  }

  static error(error: unknown): Response {
    if (error instanceof ApplicationError) {
      console.debug('Request rejected:', error.code, error.status);

      return this.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        },
        error.status,
      );
    }

    console.error('Unexpected API exception:', error instanceof Error ? error.name : typeof error);

    return this.json(
      {
        ok: false,
        error: {
          code: 'internal_error',
          message: 'Internal server error.',
        },
      },
      500,
    );
  }
}

