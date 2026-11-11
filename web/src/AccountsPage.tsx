import { useTable } from '@refinedev/antd';
import { Card, Col, Input, Row, Table, Typography } from 'antd';
import { useState } from 'react';

import { AccountDetailPanel } from './AccountDetailPanel';
import type { AccountSummary } from './Models';

export function AccountsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { tableProps, setFilters } = useTable<AccountSummary>({
    resource: 'accounts',
    pagination: { pageSize: 20 },
  });

  function searchAccounts(search: string): void {
    setFilters([{ field: 'search', operator: 'contains', value: search }], 'replace');
  }

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={11}>
        <Card
          title="Registered accounts"
          extra={<Typography.Text type="secondary">Account registry</Typography.Text>}
        >
          <Input.Search
            aria-label="Search by email or organization"
            placeholder="Search email or organization"
            allowClear
            onSearch={searchAccounts}
            style={{ marginBottom: 16 }}
          />

          <Table
            {...tableProps}
            rowKey="id"
            size="small"
            scroll={{ x: 520 }}
            onRow={(record) => ({ onClick: () => setSelectedId(record.id) })}
          >
            <Table.Column title="Email" dataIndex="email" />
            <Table.Column
              title="Organization"
              dataIndex="organizationSlug"
              render={(value: string | null) => value ?? '—'}
            />
            <Table.Column title="Hosts" dataIndex="hostCount" />
            <Table.Column title="Works" dataIndex="workCount" />
          </Table>
        </Card>
      </Col>

      <Col xs={24} xl={13}>
        <AccountDetailPanel id={selectedId} />
      </Col>
    </Row>
  );
}
