import { Descriptions, Table, Tag, Typography } from 'antd';

import type { AccountDetail, AgentSummary, AuditEvent, SessionSummary } from './Models';

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

export function AgentList({ agents }: { agents: AgentSummary[] }) {
  return (
    <section>
      <Typography.Title level={5}>Agent identities</Typography.Title>
      <Table
        dataSource={agents}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 8 }}
        scroll={{ x: 430 }}
      >
        <Table.Column title="Address handle" dataIndex="handle" />
        <Table.Column
          title="Display name"
          dataIndex="displayName"
          render={(value: string | null) => value ?? '—'}
        />
        <Table.Column title="Registered" dataIndex="createdAt" />
      </Table>
    </section>
  );
}

export function SessionList({ sessions }: { sessions: SessionSummary[] }) {
  return (
    <section>
      <Typography.Title level={5}>Agent Sessions</Typography.Title>
      <Table
        dataSource={sessions}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 8 }}
        scroll={{ x: 520 }}
      >
        <Table.Column title="Canonical address" dataIndex="canonical" />
        <Table.Column
          title="Display name"
          dataIndex="displayName"
          render={(value: string | null) => value ?? '—'}
        />
        <Table.Column
          title="Default"
          dataIndex="isDefault"
          render={(isDefault: boolean) => isDefault && <Tag color="blue">Default</Tag>}
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
