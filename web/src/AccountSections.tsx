import { Descriptions, Table, Tag, Typography } from 'antd';

import type { AccountDetail, Address, AuditEvent, Credential, Enrollment } from './Models';

export function OrganizationSummary({ account }: { account: AccountDetail }) {
  return (
    <Descriptions bordered size="small" column={1}>
      <Descriptions.Item label="Organization">
        {account.organization?.displayName ?? 'Not linked'}
      </Descriptions.Item>
      <Descriptions.Item label="Slug">
        {account.organizationSlug ?? '—'}
      </Descriptions.Item>
      <Descriptions.Item label="Registered">
        {account.createdAt}
      </Descriptions.Item>
    </Descriptions>
  );
}

export function AddressList({ addresses }: { addresses: Address[] }) {
  return (
    <section>
      <Typography.Title level={5}>Host and Work addresses</Typography.Title>
      <Table
        dataSource={addresses}
        rowKey="id"
        pagination={{ pageSize: 8 }}
        size="small"
        scroll={{ x: 450 }}
      >
        <Table.Column title="Address" dataIndex="canonical" />
        <Table.Column title="Kind" dataIndex="kind" />
        <Table.Column
          title="Status"
          dataIndex="active"
          render={(active: boolean) => (
            <Tag color={active ? 'green' : 'default'}>
              {active ? 'Active' : 'Revoked'}
            </Tag>
          )}
        />
      </Table>
    </section>
  );
}

export function CredentialList({ credentials }: { credentials: Credential[] }) {
  return (
    <section>
      <Typography.Title level={5}>Credentials (metadata only)</Typography.Title>
      <Table
        dataSource={credentials}
        rowKey="id"
        pagination={{ pageSize: 5 }}
        size="small"
        scroll={{ x: 400 }}
      >
        <Table.Column title="Type" dataIndex="kind" />
        <Table.Column title="Created" dataIndex="createdAt" />
        <Table.Column
          title="Status"
          dataIndex="revokedAt"
          render={(revokedAt: string | null) => (
            revokedAt ? <Tag>Revoked</Tag> : <Tag color="green">Active</Tag>
          )}
        />
      </Table>
    </section>
  );
}

export function EnrollmentList({ enrollments }: { enrollments: Enrollment[] }) {
  return (
    <section>
      <Typography.Title level={5}>Enrollments</Typography.Title>
      <Table
        dataSource={enrollments}
        rowKey="id"
        pagination={{ pageSize: 5 }}
        size="small"
        scroll={{ x: 430 }}
      >
        <Table.Column title="Host" dataIndex="hostHandle" />
        <Table.Column title="Expires" dataIndex="expiresAt" />
        <Table.Column
          title="Used"
          dataIndex="usedAt"
          render={(value: string | null) => value ?? 'Unused'}
        />
      </Table>
    </section>
  );
}

export function AuditEventList({ events }: { events: AuditEvent[] }) {
  return (
    <section>
      <Typography.Title level={5}>Admin audit</Typography.Title>
      <Table
        dataSource={events}
        rowKey="id"
        pagination={{ pageSize: 5 }}
        size="small"
        scroll={{ x: 420 }}
      >
        <Table.Column title="Actor" dataIndex="actorEmail" />
        <Table.Column title="Event" dataIndex="eventPath" />
        <Table.Column title="When" dataIndex="createdAt" />
      </Table>
    </section>
  );
}
