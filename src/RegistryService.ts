import { APIError, JSONRecord } from './HTTP';
import { TokenService } from './Tokens';

export type OrganizationRow = {
  id: string;
  slug: string;
  displayName: string;
  createdAt: string;
};

export type AddressRow = {
  id: string;
  orgId: string;
  parentAddressId: string | null;
  path: string;
  handle: string;
  displayName: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type CredentialRow = {
  id: string;
  kind: 'org' | 'address';
  orgId: string;
  addressId: string | null;
  revokedAt: string | null;
};

export type IssuedOrganization = {
  organization: OrganizationRow;
  token: string;
};

export type IssuedAddress = {
  address: AddressRow;
  token: string;
};

// Domain operations for organizations, addresses and credentials. It knows nothing about HTTP,
// OAuth or MCP; callers decide who is allowed to invoke each operation.
export class RegistryService {
  private static readonly ORGANIZATION_SELECT = `SELECT id, slug, display_name AS displayName, created_at AS createdAt
                                                   FROM organizations`;

  private static readonly ADDRESS_SELECT = `SELECT id,
                                                   org_id AS orgId,
                                                   parent_address_id AS parentAddressId,
                                                   path,
                                                   handle,
                                                   display_name AS displayName,
                                                   created_at AS createdAt,
                                                   revoked_at AS revokedAt
                                              FROM addresses`;

  static nowISO(): string {
    return new Date().toISOString();
  }

  static isUniqueViolation(error: unknown): boolean {
    return String(error).toLowerCase().includes('unique');
  }

  static publicOrganization(org: OrganizationRow): JSONRecord {
    return {
      id: org.id,
      slug: org.slug,
      displayName: org.displayName,
      createdAt: org.createdAt,
    };
  }

  static publicAddress(orgSlug: string, address: AddressRow): JSONRecord {
    const parentPath = address.path.includes('/')
      ? address.path.slice(0, address.path.lastIndexOf('/'))
      : null;

    return {
      id: address.id,
      kind: address.parentAddressId ? 'work' : 'host',
      org: orgSlug,
      handle: address.handle,
      path: address.path,
      address: `@${address.path}`,
      canonical: `${orgSlug}/${address.path}`,
      parentAddressId: address.parentAddressId,
      parentCanonical: parentPath ? `${orgSlug}/${parentPath}` : null,
      displayName: address.displayName,
      active: !address.revokedAt,
      createdAt: address.createdAt,
    };
  }

  constructor(private readonly db: D1Database) {}

  async authenticate(token: string, expectedKind?: 'org' | 'address'): Promise<CredentialRow> {
    const tokenHash = await TokenService.sha256Hex(token);
    const credential = await this.db
      .prepare(
        `SELECT id,
                kind,
                org_id AS orgId,
                address_id AS addressId,
                revoked_at AS revokedAt
           FROM credentials
          WHERE token_hash = ?`,
      )
      .bind(tokenHash)
      .first<CredentialRow>();

    if (!credential || credential.revokedAt) {
      throw new APIError(401, 'invalid_token', 'Credential is invalid or revoked.');
    }
    if (expectedKind && credential.kind !== expectedKind) {
      throw new APIError(403, 'wrong_credential_type', `${expectedKind} credential required.`);
    }

    return credential;
  }

  async getOrganizationBySlug(slug: string): Promise<OrganizationRow> {
    const organization = await this.db
      .prepare(`${RegistryService.ORGANIZATION_SELECT} WHERE slug = ? COLLATE NOCASE`)
      .bind(slug)
      .first<OrganizationRow>();
    if (!organization) {
      throw new APIError(404, 'org_not_found', 'Organization not found.');
    }

    return organization;
  }

  async findOrganizationBySlug(slug: string): Promise<OrganizationRow | null> {
    return this.db
      .prepare(`${RegistryService.ORGANIZATION_SELECT} WHERE slug = ? COLLATE NOCASE`)
      .bind(slug)
      .first<OrganizationRow>();
  }

  async getOrganizationById(id: string): Promise<OrganizationRow> {
    const organization = await this.db
      .prepare(`${RegistryService.ORGANIZATION_SELECT} WHERE id = ?`)
      .bind(id)
      .first<OrganizationRow>();
    if (!organization) {
      throw new APIError(401, 'invalid_token', 'Organization no longer exists.');
    }
    return organization;
  }

  async getAddressById(id: string): Promise<AddressRow> {
    const address = await this.db
      .prepare(`${RegistryService.ADDRESS_SELECT} WHERE id = ?`)
      .bind(id)
      .first<AddressRow>();
    if (!address) {
      throw new APIError(404, 'address_not_found', 'Address not found.');
    }

    return address;
  }

  async getActiveAddressById(id: string): Promise<AddressRow> {
    const address = await this.getAddressById(id);
    if (address.revokedAt) {
      throw new APIError(404, 'address_not_found', 'Address is revoked.');
    }

    return address;
  }

  async findActiveAddressByPath(orgId: string, path: string): Promise<AddressRow | null> {
    return this.db
      .prepare(`${RegistryService.ADDRESS_SELECT} WHERE org_id = ? AND path = ? COLLATE NOCASE AND revoked_at IS NULL`)
      .bind(orgId, path)
      .first<AddressRow>();
  }

  async listAddresses(orgId: string): Promise<AddressRow[]> {
    const result = await this.db
      .prepare(`${RegistryService.ADDRESS_SELECT} WHERE org_id = ? ORDER BY path COLLATE NOCASE`)
      .bind(orgId)
      .all<AddressRow>();
    return result.results;
  }

  async listActiveWorks(
    orgID: string,
    cursor: string,
    search: string,
    limit: number,
  ): Promise<AddressRow[]> {
    const rows = await this.db.prepare(
      `${RegistryService.ADDRESS_SELECT}
       WHERE org_id = ? AND revoked_at IS NULL
         AND parent_address_id IN (
           SELECT id FROM addresses
            WHERE org_id = ? AND parent_address_id IS NULL AND revoked_at IS NULL
         )
         AND (? = '' OR path COLLATE NOCASE > ? COLLATE NOCASE)
         AND (
           ? = '' OR instr(lower(path), lower(?)) > 0
             OR instr(lower(COALESCE(display_name, '')), lower(?)) > 0
         )
       ORDER BY path COLLATE NOCASE ASC
       LIMIT ?`,
    ).bind(orgID, orgID, cursor, cursor, search, search, search, limit).all<AddressRow>();

    return rows.results;
  }

  async listActiveHosts(orgId: string): Promise<AddressRow[]> {
    const result = await this.db
      .prepare(
        `${RegistryService.ADDRESS_SELECT}
          WHERE org_id = ? AND parent_address_id IS NULL AND revoked_at IS NULL
          ORDER BY path COLLATE NOCASE`,
      )
      .bind(orgId)
      .all<AddressRow>();
    return result.results;
  }

  async createOrganization(slug: string, displayName: string): Promise<IssuedOrganization> {
    const id = crypto.randomUUID();
    const token = TokenService.randomToken('org');
    const tokenHash = await TokenService.sha256Hex(token);
    const createdAt = RegistryService.nowISO();

    try {
      await this.db.batch([
        this.db
          .prepare('INSERT INTO organizations (id, slug, display_name, created_at) VALUES (?, ?, ?, ?)')
          .bind(id, slug, displayName, createdAt),
        this.db
          .prepare(
            `INSERT INTO credentials (id, kind, org_id, address_id, token_hash, created_at)
             VALUES (?, 'org', ?, NULL, ?, ?)`,
          )
          .bind(crypto.randomUUID(), id, tokenHash, createdAt),
      ]);
    } catch (error) {
      console.debug('Organization registration write failed:', error);

      if (RegistryService.isUniqueViolation(error)) {
        throw new APIError(409, 'org_slug_taken', 'That organization slug is already registered.');
      }

      throw error;
    }

    return { organization: { id, slug, displayName, createdAt }, token };
  }

  async createAddress(
    org: OrganizationRow,
    handle: string,
    displayName: string | null,
    parentAddress: AddressRow | null,
  ): Promise<IssuedAddress> {
    const id = crypto.randomUUID();
    const token = TokenService.randomToken('addr');
    const tokenHash = await TokenService.sha256Hex(token);
    const createdAt = RegistryService.nowISO();
    const path = parentAddress ? `${parentAddress.path}/${handle}` : handle;

    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO addresses
              (id, org_id, parent_address_id, path, handle, display_name, created_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .bind(id, org.id, parentAddress?.id ?? null, path, handle, displayName, createdAt),
        this.db
          .prepare(
            `INSERT INTO credentials (id, kind, org_id, address_id, token_hash, created_at)
             VALUES (?, 'address', ?, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), org.id, id, tokenHash, createdAt),
      ]);
    } catch (error) {
      console.debug('Address creation write failed:', error);

      if (RegistryService.isUniqueViolation(error)) {
        throw new APIError(409, 'address_taken', `@${path} already exists in ${org.slug}.`);
      }

      throw error;
    }

    const address: AddressRow = {
      id,
      orgId: org.id,
      parentAddressId: parentAddress?.id ?? null,
      path,
      handle,
      displayName,
      createdAt,
      revokedAt: null,
    };
    return { address, token };
  }

  async renameAddress(address: AddressRow, newHandle: string): Promise<AddressRow> {
    const slashIndex = address.path.lastIndexOf('/');
    const parentPath = slashIndex >= 0 ? address.path.slice(0, slashIndex) : null;
    const newPath = parentPath ? `${parentPath}/${newHandle}` : newHandle;
    const oldPath = address.path;

    try {
      await this.db.batch([
        this.db.prepare('UPDATE addresses SET handle = ?, path = ? WHERE id = ?').bind(newHandle, newPath, address.id),
        this.db
          .prepare(
            `UPDATE addresses
                SET path = ? || substr(path, length(?) + 1)
              WHERE org_id = ?
                AND substr(path, 1, length(?) + 1) = ? || '/'`,
          )
          .bind(newPath, oldPath, address.orgId, oldPath, oldPath),
      ]);
    } catch (error) {
      console.debug('Address rename write failed:', error);

      if (RegistryService.isUniqueViolation(error)) {
        throw new APIError(409, 'address_taken', `@${newPath} already exists.`);
      }

      throw error;
    }

    return { ...address, handle: newHandle, path: newPath };
  }

  async revokeAddressTree(addressId: string): Promise<AddressRow> {
    const address = await this.getAddressById(addressId);
    if (address.revokedAt) {
      return address;
    }

    const revokedAt = RegistryService.nowISO();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE addresses
              SET revoked_at = ?
            WHERE org_id = ?
              AND (id = ? OR substr(path, 1, length(?) + 1) = ? || '/')`,
        )
        .bind(revokedAt, address.orgId, address.id, address.path, address.path),
      this.db
        .prepare(
          `UPDATE credentials
              SET revoked_at = ?
            WHERE kind = 'address' AND revoked_at IS NULL AND address_id IN (
              SELECT id
                FROM addresses
               WHERE org_id = ?
                 AND (id = ? OR substr(path, 1, length(?) + 1) = ? || '/')
            )`,
        )
        .bind(revokedAt, address.orgId, address.id, address.path, address.path),
    ]);

    return { ...address, revokedAt };
  }

  async revokeEmptySmokeHost(address: AddressRow): Promise<AddressRow> {
    const now = RegistryService.nowISO();
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE addresses
            SET revoked_at = ?
          WHERE id = ? AND org_id = ? AND parent_address_id IS NULL AND revoked_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM addresses child
              WHERE child.parent_address_id = ? AND child.revoked_at IS NULL
            )`,
      ).bind(now, address.id, address.orgId, address.id),
      this.db.prepare(
        `UPDATE credentials
            SET revoked_at = ?
          WHERE address_id = ? AND kind = 'address' AND revoked_at IS NULL
            AND EXISTS (SELECT 1 FROM addresses WHERE id = ? AND revoked_at = ?)`,
      ).bind(now, address.id, address.id, now),
    ]);

    if (results[0].meta.changes !== 1) {
      throw new APIError(409, 'smoke_host_not_empty',
        'Test Host still has active Work identities or was already revoked.');
    }

    return { ...address, revokedAt: now };
  }

  async rotateAddressToken(address: AddressRow): Promise<string> {
    const token = TokenService.randomToken('addr');
    const tokenHash = await TokenService.sha256Hex(token);
    const now = RegistryService.nowISO();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE credentials
              SET revoked_at = ?
            WHERE address_id = ? AND kind = 'address' AND revoked_at IS NULL`,
        )
        .bind(now, address.id),
      this.db
        .prepare(
          `INSERT INTO credentials (id, kind, org_id, address_id, token_hash, created_at)
           VALUES (?, 'address', ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), address.orgId, address.id, tokenHash, now),
    ]);
    return token;
  }

  async rotateOrganizationToken(org: OrganizationRow): Promise<string> {
    const token = TokenService.randomToken('org');
    const tokenHash = await TokenService.sha256Hex(token);
    const now = RegistryService.nowISO();
    await this.db.batch([
      this.db
        .prepare(`UPDATE credentials SET revoked_at = ? WHERE org_id = ? AND kind = 'org' AND revoked_at IS NULL`)
        .bind(now, org.id),
      this.db
        .prepare(
          `INSERT INTO credentials (id, kind, org_id, address_id, token_hash, created_at)
           VALUES (?, 'org', ?, NULL, ?, ?)`,
        )
        .bind(crypto.randomUUID(), org.id, tokenHash, now),
    ]);
    return token;
  }
}
