import type { BaseRecord } from '@refinedev/core';

export interface AccountSummary extends BaseRecord {
  id: string;
  email: string;
  orgId: string | null;
  organizationSlug: string | null;
  createdAt: string;
  agentCount: number;
  sessionCount: number;
}

export type AgentSummary = {
  id: string;
  handle: string;
  displayName: string | null;
  createdAt: string;
};

export type SessionSummary = {
  id: string;
  agentId: string;
  agentHandle: string;
  handle: string;
  canonical: string;
  displayName: string | null;
  isDefault: boolean;
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  actorEmail: string;
  eventPath: string;
  createdAt: string;
};

export interface AccountDetail extends AccountSummary {
  organization: { id: string; slug: string; displayName: string } | null;
  agents: AgentSummary[];
  sessions: SessionSummary[];
  auditEvents: AuditEvent[];
}
