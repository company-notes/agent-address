import { Alert, Button, Card, Divider, Form, Input, List, Popconfirm, Space, Tag, Typography } from 'antd';

import type { Agent, IdentityRegistration, Organization, Session } from './PortalAPI';
import { OrganizationEditor, type OrganizationFields } from './OrganizationEditor';

export type { OrganizationFields } from './OrganizationEditor';

export type AgentFields = {
  agentName?: string;
  sessionName?: string;
  agentDisplayName?: string;
  sessionDisplayName?: string;
};

export type SessionFields = {
  newSessionName?: string;
  newSessionDisplayName?: string;
};

export function OrganizationRegistrationCard({
  loading,
  onRegister,
}: {
  loading: boolean;
  onRegister: (fields: OrganizationFields) => void;
}) {
  return (
    <Card title="Register your Organization">
      <Form layout="vertical" onFinish={onRegister}>
        <Form.Item label="Organization handle" name="slug" rules={[{ required: true }]}>
          <Input placeholder="nuwa" />
        </Form.Item>

        <Form.Item label="Display name" name="displayName" rules={[{ required: true }]}>
          <Input placeholder="Nuwa Information" />
        </Form.Item>

        <Button htmlType="submit" type="primary" loading={loading}>
          Register Organization
        </Button>
      </Form>
    </Card>
  );
}

export function OrganizationOverviewCard({
  organization,
  loading,
  onUpdate,
}: {
  organization: Organization;
  loading: boolean;
  onUpdate: (fields: OrganizationFields) => void;
}) {
  return (
    <Card title={organization.displayName}>
      <Typography.Paragraph type="secondary">
        Organization: {organization.slug}
      </Typography.Paragraph>

      <OrganizationEditor organization={organization} loading={loading} onSave={onUpdate} />
    </Card>
  );
}

export function AgentRegistryCard({
  agents,
  loading,
  onSelect,
  onCreate,
  onEdit,
  onArchive,
}: {
  agents: Agent[];
  loading: boolean;
  onSelect: (agent: Agent) => void;
  onCreate: (fields: AgentFields) => void;
  onEdit: (agent: Agent) => void;
  onArchive: (agentID: string) => void;
}) {
  return (
    <Card title="Your Agents">
      <List
        dataSource={agents}
        rowKey="id"
        renderItem={(agent) => (
          <List.Item>
            <div style={{ width: '100%', minWidth: 0 }}>
              <List.Item.Meta
                title={agent.displayName ?? agent.handle}
                description={agent.handle}
              />

              <Space wrap size="small">
                <Button onClick={() => onSelect(agent)}>Sessions</Button>
                <Button onClick={() => onEdit(agent)}>Edit Agent</Button>
                <Popconfirm
                  title="Archive this Agent?"
                  description="All Sessions will be archived and their Runtime leases revoked."
                  okText="Archive Agent"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => onArchive(agent.id)}
                >
                  <Button danger disabled={loading}>Archive Agent</Button>
                </Popconfirm>
              </Space>
            </div>
          </List.Item>
        )}
      />

      <Divider />

      <Form layout="vertical" onFinish={onCreate}>
        <Typography.Title level={5}>Create an Agent</Typography.Title>

        <Form.Item name="agentName" label="Agent handle (optional)">
          <Input placeholder="xiaoming" />
        </Form.Item>

        <Form.Item name="agentDisplayName" label="Agent display name (optional)">
          <Input placeholder="小明" />
        </Form.Item>

        <Form.Item name="sessionName" label="Default Session handle (optional)">
          <Input placeholder="main" />
        </Form.Item>

        <Form.Item name="sessionDisplayName" label="Default Session display name (optional)">
          <Input placeholder="主要對話" />
        </Form.Item>

        <Button htmlType="submit" loading={loading}>
          Create Agent
        </Button>
      </Form>
    </Card>
  );
}

export function SessionRegistryCard({
  agent,
  sessions,
  loading,
  onCreate,
  onEdit,
  onDefault,
  onArchive,
  onRotate,
}: {
  agent: Agent | null;
  sessions: Session[];
  loading: boolean;
  onCreate: (agentID: string, fields: SessionFields) => void;
  onEdit: (session: Session) => void;
  onDefault: (sessionID: string) => void;
  onArchive: (sessionID: string) => void;
  onRotate: (sessionID: string) => void;
}) {
  return (
    <Card title={agent ? `Sessions: ${agent.handle}` : 'Sessions'}>
      {agent ? (
        <>
          <List
            dataSource={sessions}
            rowKey="id"
            renderItem={(session) => (
              <List.Item>
                <div style={{ width: '100%', minWidth: 0 }}>
                  <List.Item.Meta
                    title={session.canonical}
                    description={
                      <Space wrap>
                        {session.displayName && <Typography.Text>{session.displayName}</Typography.Text>}
                        {session.isDefault && <Tag color="blue">Default Session</Tag>}
                        {session.runtime
                          ? <Tag color="green">Active Runtime: {session.runtime.label ?? 'Unnamed'}</Tag>
                          : <Tag>Available</Tag>}
                      </Space>
                    }
                  />

                  <Space wrap size="small">
                    <Button onClick={() => onEdit(session)}>Edit Session</Button>
                    <Button
                      disabled={loading || session.isDefault}
                      onClick={() => onDefault(session.id)}
                    >
                      Make Default
                    </Button>
                    <Popconfirm
                      title="Replace this Session's resume token?"
                      description="The previous resume token will stop working immediately."
                      okText="Rotate Token"
                      onConfirm={() => onRotate(session.id)}
                    >
                      <Button disabled={loading}>Rotate Resume Token</Button>
                    </Popconfirm>
                    <Popconfirm
                      title="Archive this Session?"
                      description="This permanently revokes its Runtime lease and resume capability."
                      okText="Archive Session"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => onArchive(session.id)}
                    >
                      <Button danger disabled={loading || session.isDefault}>Archive Session</Button>
                    </Popconfirm>
                  </Space>
                </div>
              </List.Item>
            )}
          />

          <Divider />

          <Form layout="vertical" onFinish={(fields: SessionFields) => onCreate(agent.id, fields)}>
            <Form.Item name="newSessionName" label="New Session handle (optional)">
              <Input placeholder="ffl-dev" />
            </Form.Item>

            <Form.Item name="newSessionDisplayName" label="New Session display name (optional)">
              <Input placeholder="FFL 開發" />
            </Form.Item>

            <Button htmlType="submit" loading={loading}>
              Create Session
            </Button>
          </Form>
        </>
      ) : (
        <Typography.Text type="secondary">
          Choose an Agent to inspect its Sessions.
        </Typography.Text>
      )}
    </Card>
  );
}

export function IdentitySecretNotice({
  identity,
  rotated,
  onClose,
}: {
  identity: IdentityRegistration;
  rotated: boolean;
  onClose: () => void;
}) {
  return (
    <Alert
      type="success"
      showIcon
      closable
      onClose={onClose}
      message={rotated ? 'Resume token replaced' : 'Created ' + identity.session.canonical}
      description={
        <div>
          <p>Save this one-time resume token securely. A Runtime needs it to resume this Session.</p>
          <p>Session: <code>{identity.session.canonical}</code></p>
          <p>Resume token: <code>{identity.resumeToken}</code></p>
        </div>
      }
    />
  );
}
