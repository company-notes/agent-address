import type { BaseRecord } from '@refinedev/core';

export interface AccountSummary extends BaseRecord {
  id: string;
  email: string;
  orgId: string | null;
  organizationSlug: string | null;
  createdAt: string;
  hostCount: number;
  workCount: number;
}

export interface Address {
  id: string;
  canonical: string;
  kind: string;
  active: boolean;
  createdAt: string;
}

export interface Credential {
  id: string;
  kind: string;
  addressId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface Enrollment {
  id: string;
  hostHandle: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface AuditEvent {
  id: string;
  actorEmail: string;
  eventPath: string;
  createdAt: string;
}

export interface AccountDetail extends AccountSummary {
  organization: { slug: string; displayName: string } | null;
  addresses: Address[];
  credentials: Credential[];
  enrollments: Enrollment[];
  auditEvents: AuditEvent[];
}
