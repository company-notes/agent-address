import { Refine } from '@refinedev/core';
import { ConfigProvider, Layout, Typography } from 'antd';

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
            <Typography.Title level={4} className="admin-title">Agent Address · Administration</Typography.Title>
          </Layout.Header>
          <Layout.Content className="admin-content">
            <AccountsPage />
          </Layout.Content>
        </Layout>
      </Refine>
    </ConfigProvider>
  );
}
