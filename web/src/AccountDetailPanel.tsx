import { useOne } from '@refinedev/core';
import { Alert, Card, Divider, Empty, Spin } from 'antd';

import {
  AddressList,
  AuditEventList,
  CredentialList,
  EnrollmentList,
  OrganizationSummary,
} from './AccountSections';
import type { AccountDetail } from './Models';
import { PasswordResetForm } from './PasswordResetForm';

export function AccountDetailPanel({ id }: { id: string | null }) {
  const query = useOne<AccountDetail>({
    resource: 'accounts',
    id: id ?? '',
    queryOptions: { enabled: Boolean(id) },
  });

  if (!id) {
    return (
      <Card>
        <Empty description="Select an account to inspect its addresses and credentials." />
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
      <OrganizationSummary account={account} />

      <Divider />
      <AddressList addresses={account.addresses} />
      <CredentialList credentials={account.credentials} />
      <EnrollmentList enrollments={account.enrollments} />

      <Divider />
      <PasswordResetForm key={account.id} accountId={account.id} />

      <Divider />
      <AuditEventList events={account.auditEvents} />
    </Card>
  );
}
