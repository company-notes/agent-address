import { useInvalidate, useOne } from '@refinedev/core';
import { Alert, Card, Divider, Empty, Spin, message } from 'antd';
import { useState } from 'react';

import {
  AgentList,
  AuditEventList,
  OrganizationSummary,
  SessionList,
} from './AccountSections';
import type { AccountDetail } from './Models';
import { PasswordResetForm } from './PasswordResetForm';
import { OrganizationEditor, type OrganizationFields } from './OrganizationEditor';
import { adminAPI } from './AdminDataProvider';

export function AccountDetailPanel({ id }: { id: string | null }) {
  const invalidate = useInvalidate();
  const [working, setWorking] = useState(false);
  const [messageAPI, contextHolder] = message.useMessage();
  const query = useOne<AccountDetail>({
    resource: 'accounts',
    id: id ?? '',
    queryOptions: { enabled: Boolean(id) },
  });

  async function updateOrganization(fields: OrganizationFields) {
    if (!id) {
      return;
    }

    setWorking(true);

    try {
      await adminAPI.updateOrganization(id, fields);
      await invalidate({ resource: 'accounts', invalidates: ['list', 'detail'], id });
      messageAPI.success('Organization updated.');
    } catch (error) {
      console.error('Admin Organization update failed:', error);
      messageAPI.error(error instanceof Error ? error.message : 'Organization update failed.');
    } finally {
      setWorking(false);
    }
  }

  if (!id) {
    return (
      <Card>
        <Empty description="Select an account to inspect its Agents and Sessions." />
      </Card>
    );
  }

  if (query.query.isLoading) {
    return (
      <Card>
        <Spin />
      </Card>
    );
  }

  if (query.query.error) {
    return <Alert type="error" message={query.query.error.message} showIcon />;
  }

  const account = query.result;
  if (!account) {
    return <Empty description="No account data." />;
  }

  return (
    <Card title={account.email} className="account-detail">
      {contextHolder}
      <OrganizationSummary account={account} />
      {account.organization && (
        <OrganizationEditor
          key={account.organization.id}
          organization={account.organization}
          loading={working}
          onSave={(fields) => void updateOrganization(fields)}
        />
      )}

      <Divider />
      <AgentList agents={account.agents} />
      <SessionList sessions={account.sessions} />

      <Divider />
      <PasswordResetForm key={account.id} accountId={account.id} />

      <Divider />
      <AuditEventList events={account.auditEvents} />
    </Card>
  );
}
