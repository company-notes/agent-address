import { ApplicationError } from './ApplicationError';
import { IdentityNames } from './IdentityNames';

export type RegistrationType = 'personal' | 'team';

export class RegistrationNames {
  static type(value: string): RegistrationType {
    if (!value || value === 'personal') {
      return 'personal';
    }
    if (value === 'team') {
      return 'team';
    }

    throw new ApplicationError(400, 'invalid_organization_type', 'Choose personal or team use.');
  }

  static defaults(type: RegistrationType) {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const prefix = type === 'personal' ? 'personal' : 'company';

    return {
      slug: prefix + '-' + suffix,
      displayName: prefix[0].toUpperCase() + prefix.slice(1) + ' ' + suffix,
    };
  }

  static resolve(type: RegistrationType, slug: string, displayName: string) {
    const defaults = this.defaults(type);

    return {
      slug: IdentityNames.organizationSlug(slug.trim() || defaults.slug),
      displayName: IdentityNames.organizationDisplayName(displayName.trim() || defaults.displayName),
    };
  }
}
