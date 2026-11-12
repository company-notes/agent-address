import { Refine } from '@refinedev/core';
import { Button, ConfigProvider, Layout, Space, Typography } from 'antd';

import { AccountsPage } from './AccountsPage';
import { PortalApp } from './PortalApp';
import { adminDataProvider } from './AdminDataProvider';

export function App() {
  if (window.location.pathname.startsWith('/portal')) {
    return <PortalApp />;
  }

  return (
    <ConfigProvider>
      <Refine
        dataProvider={adminDataProvider}
        resources={[{ name: 'accounts', list: '/admin/' }]}
        options={{ syncWithLocation: false }}
      >
        <Layout className="admin-layout">
          <Layout.Header className="admin-header">
            <Space size="large" align="center">
            <Typography.Title level={4} className="admin-title">
              Agent Address · Administration
            </Typography.Title>
            <Button type="link" href="/portal/">
              Organization Portal
            </Button>
          </Space>
          </Layout.Header>
          <Layout.Content className="admin-content">
            <AccountsPage />
          </Layout.Content>
        </Layout>
      </Refine>
    </ConfigProvider>
  );
}
