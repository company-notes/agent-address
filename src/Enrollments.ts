import { APIError } from './HTTP';
import { AddressRow, OrganizationRow, RegistryService } from './RegistryService';
import { TokenService } from './Tokens';

type EnrollmentRow = {
  orgId: string;
  hostHandle: string;
};

export type CreatedEnrollment = {
  code: string;
  expiresAt: string;
};

export type RedeemedEnrollment = {
  organization: OrganizationRow;
  address: AddressRow;
  token: string;
};

// One-time codes that let a local machine obtain the host credential for a host address
// that an account already manages, without the credential passing through an LLM session.
export class EnrollmentService {
  static readonly TTL_MS = 15 * 60 * 1000;

  constructor(
    private readonly db: D1Database,
    private readonly registry: RegistryService,
  ) {}

  async create(org: OrganizationRow, hostHandle: string): Promise<CreatedEnrollment> {
    const code = TokenService.randomToken('enr');
    const now = Date.now();
    const expiresAt = new Date(now + EnrollmentService.TTL_MS).toISOString();
    await this.db
      .prepare(
        `INSERT INTO enrollments (id, org_id, host_handle, code_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        org.id,
        hostHandle,
        await TokenService.sha256Hex(code),
        expiresAt,
        new Date(now).toISOString(),
      )
      .run();

    return { code, expiresAt };
  }

  async redeem(code: string): Promise<RedeemedEnrollment> {
    const codeHash = await TokenService.sha256Hex(code);
    const claimed = await this.db
      .prepare(
        `UPDATE enrollments
            SET used_at = ?
          WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(RegistryService.nowISO(), codeHash, RegistryService.nowISO())
      .run();
    if (claimed.meta?.changes !== 1) {
      throw new APIError(400, 'invalid_enrollment', 'Enrollment code is invalid, expired or already used.');
    }

    const enrollment = await this.db
      .prepare('SELECT org_id AS orgId, host_handle AS hostHandle FROM enrollments WHERE code_hash = ?')
      .bind(codeHash)
      .first<EnrollmentRow>();
    if (!enrollment) {
      throw new APIError(400, 'invalid_enrollment', 'Enrollment code is invalid, expired or already used.');
    }

    const organization = await this.registry.getOrganizationById(enrollment.orgId);
    const existing = await this.registry.findActiveAddressByPath(organization.id, enrollment.hostHandle);
    if (existing) {
      return { organization, address: existing, token: await this.registry.rotateAddressToken(existing) };
    }

    const issued = await this.registry.createAddress(organization, enrollment.hostHandle, null, null);

    return { organization, address: issued.address, token: issued.token };
  }
}
