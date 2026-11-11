import { useOne } from '@refinedev/core';
import { Alert, Card, Descriptions, Divider, Empty, Spin, Table, Tag, Typography } from 'antd';

import type { AccountDetail } from './Models';
import { PasswordResetForm } from './PasswordResetForm';

export function AccountDetailPanel({ id }: { id: string | null }) {
  const query = useOne<AccountDetail>({
    resource: 'accounts',
    id: id ?? '',
    queryOptions: { enabled: Boolean(id) },
  });

  if (!id) {
    return <Card><Empty description="Select an account to inspect its addresses and credentials." /></Card>;
  }
  if (query.query.isLoading) {
    return <Card><Spin /></Card>;
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
      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label="Organization">{account.organization?.displayName ?? 'Not linked'}</Descriptions.Item>
        <Descriptions.Item label="Slug">{account.organizationSlug ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Registered">{account.createdAt}</Descriptions.Item>
      </Descriptions>

      <Divider />
      <Typography.Title level={5}>Host and Work addresses</Typography.Title>
      <Table dataSource={account.addresses} rowKey="id" pagination={{ pageSize: 8 }} size="small" scroll={{ x: 450 }}>
        <Table.Column title="Address" dataIndex="canonical" />
        <Table.Column title="Kind" dataIndex="kind" />
        <Table.Column title="Status" dataIndex="active" render={(active: boolean) =>
          <Tag color={active ? 'green' : 'default'}>{active ? 'Active' : 'Revoked'}</Tag>} />
      </Table>

      <Typography.Title level={5}>Credentials (metadata only)</Typography.Title>
      <Table dataSource={account.credentials} rowKey="id" pagination={{ pageSize: 5 }} size="small" scroll={{ x: 400 }}>
        <Table.Column title="Type" dataIndex="kind" />
        <Table.Column title="Created" dataIndex="createdAt" />
        <Table.Column title="Status" dataIndex="revokedAt" render={(revokedAt: string | null) =>
          revokedAt ? <Tag>Revoked</Tag> : <Tag color="green">Active</Tag>} />
      </Table>

      <Typography.Title level={5}>Enrollments</Typography.Title>
      <Table dataSource={account.enrollments} rowKey="id" pagination={{ pageSize: 5 }} size="small" scroll={{ x: 430 }}>
        <Table.Column title="Host" dataIndex="hostHandle" />
        <Table.Column title="Expires" dataIndex="expiresAt" />
        <Table.Column title="Used" dataIndex="usedAt" render={(value: string | null) => value ?? 'Unused'} />
      </Table>

      <Divider />
      <PasswordResetForm key={account.id} accountId={account.id} />

      <Divider />
      <Typography.Title level={5}>Admin audit</Typography.Title>
      <Table dataSource={account.auditEvents} rowKey="id" pagination={{ pageSize: 5 }} size="small" scroll={{ x: 420 }}>
        <Table.Column title="Actor" dataIndex="actorEmail" />
        <Table.Column title="Event" dataIndex="eventPath" />
        <Table.Column title="When" dataIndex="createdAt" />
      </Table>
    </Card>
  );
}
