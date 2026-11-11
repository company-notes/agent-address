export type JSONRecord = Record<string, unknown>;

export class APIError extends Error {
  status: number;
  code: string;
  details?: JSONRecord;

  constructor(status: number, code: string, message: string, details?: JSONRecord) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class RequestData {
  static readonly ORG_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  static readonly HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/;

  static bearerToken(request: Request, errorMessage = 'Bearer token required.'): string {
    const authorization = request.headers.get('authorization') ?? '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      throw new APIError(401, 'unauthorized', errorMessage);
    }

    return match[1].trim();
  }

  static async readJSON(request: Request): Promise<JSONRecord> {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new APIError(415, 'unsupported_media_type', 'Use application/json.');
    }

    let data: unknown;
    try {
      data = await request.json();
    } catch (error) {
      console.debug('Invalid JSON request body:', error);
      throw new APIError(400, 'invalid_json', 'Request body must be a JSON object.');
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new APIError(400, 'invalid_json', 'Request body must be a JSON object.');
    }

    return data as JSONRecord;
  }

  static requiredString(data: JSONRecord, key: string, maxLength = 128): string {
    const value = data[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new APIError(400, 'invalid_request', `${key} is required.`);
    }

    const result = value.trim();
    if (result.length > maxLength) {
      throw new APIError(400, 'invalid_request', `${key} is too long.`);
    }

    return result;
  }

  static optionalString(data: JSONRecord, key: string, maxLength = 128): string | null {
    const value = data[key];
    if (value == null || value === '') {
      return null;
    }
    if (typeof value !== 'string') {
      throw new APIError(400, 'invalid_request', `${key} must be a string.`);
    }

    const result = value.trim();
    if (result.length > maxLength) {
      throw new APIError(400, 'invalid_request', `${key} is too long.`);
    }

    return result || null;
  }

  static normalizeOrgSlug(value: string): string {
    const slug = value.trim().toLowerCase();
    if (!this.ORG_SLUG_RE.test(slug)) {
      throw new APIError(
        400,
        'invalid_org_slug',
        'Org slug must be 1-63 lowercase letters, numbers, or hyphens, and cannot start/end with a hyphen.',
      );
    }

    return slug;
  }

  static normalizeHandle(value: string): string {
    const handle = value.trim().toLowerCase().replace(/^@/, '');
    if (!this.HANDLE_RE.test(handle)) {
      throw new APIError(
        400,
        'invalid_handle',
        'Address handle must be 1-63 lowercase letters, numbers, hyphens, or underscores.',
      );
    }

    return handle;
  }

  static normalizePath(value: string): string {
    const rawPath = value.trim().replace(/^@/, '').replace(/^\/+|\/+$/g, '');
    if (!rawPath) {
      throw new APIError(400, 'invalid_path', 'Address path is required.');
    }

    const segments = rawPath.split('/').map((segment) => this.normalizeHandle(segment));

    return segments.join('/');
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
    if (error instanceof APIError) {
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

    console.error(error);
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

