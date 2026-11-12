import { ApplicationError } from './ApplicationError';

// Address grammar is a domain concern, not an HTTP request parser.
export class IdentityNames {
  private static readonly ORG_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  private static readonly HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/;

  static organizationSlug(value: string): string {
    const slug = value.trim().toLowerCase();

    if (!this.ORG_SLUG_RE.test(slug)) {
      throw new ApplicationError(
        400,
        'invalid_org_slug',
        'Org slug must be 1-63 lowercase letters, numbers, or hyphens, and cannot start/end with a hyphen.',
      );
    }

    return slug;
  }

  static handle(value: string): string {
    const handle = value.trim().toLowerCase();

    if (!this.HANDLE_RE.test(handle)) {
      throw new ApplicationError(
        400,
        'invalid_handle',
        'Address handle must be 1-63 lowercase letters, numbers, hyphens, or underscores.',
      );
    }

    return handle;
  }

  static path(value: string): string {
    const raw = value.trim().replace(/^\/+|\/+$/g, '');

    if (!raw) {
      throw new ApplicationError(400, 'invalid_path', 'Address path is required.');
    }

    return raw.split('/').map((segment) => this.handle(segment)).join('/');
  }
}
