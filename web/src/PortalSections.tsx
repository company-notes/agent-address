import { Alert, Button, Card, Divider, Form, Input, List, Typography } from 'antd';

import type { Agent, IdentityRegistration, Session } from './PortalAPI';

export type OrganizationFields = {
  slug: string;
  displayName: string;
};

export type AgentFields = {
  agentName?: string;
  sessionName?: string;
};

export type SessionFields = {
  newSessionName?: string;
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

export function AgentRegistryCard({
  agents,
  loading,
  onSelect,
  onCreate,
}: {
  agents: Agent[];
  loading: boolean;
  onSelect: (agent: Agent) => void;
  onCreate: (fields: AgentFields) => void;
}) {
  return (
    <Card title="Your Agents">
      <List
        dataSource={agents}
        rowKey="id"
        renderItem={(agent) => (
          <List.Item
            actions={[
              <Button key={agent.id} onClick={() => onSelect(agent)}>
                Sessions
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={agent.displayName ?? agent.handle}
              description={agent.handle}
            />
          </List.Item>
        )}
      />

      <Divider />

      <Form layout="vertical" onFinish={onCreate}>
        <Typography.Title level={5}>Create an Agent</Typography.Title>

        <Form.Item name="agentName" label="Agent handle (optional)">
          <Input placeholder="xiaoming" />
        </Form.Item>

        <Form.Item name="sessionName" label="Default Session handle (optional)">
          <Input placeholder="main" />
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
}: {
  agent: Agent | null;
  sessions: Session[];
  loading: boolean;
  onCreate: (agentID: string, fields: SessionFields) => void;
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
                <List.Item.Meta
                  title={session.canonical}
                  description={session.isDefault ? 'Default Session' : session.displayName}
                />
              </List.Item>
            )}
          />

          <Divider />

          <Form layout="vertical" onFinish={(fields: SessionFields) => onCreate(agent.id, fields)}>
            <Form.Item name="newSessionName" label="New Session handle (optional)">
              <Input placeholder="ffl-dev" />
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

export function IdentityCreatedNotice({ identity }: { identity: IdentityRegistration }) {
  return (
    <Alert
      type="success"
      showIcon
      message={'Created ' + identity.session.canonical}
      description={
        <div>
          <p>Save this one-time resume capability securely. A Runtime may use it to acquire the Session.</p>
          <p>Resume token: <code>{identity.resumeToken}</code></p>
        </div>
      }
    />
  );
}
