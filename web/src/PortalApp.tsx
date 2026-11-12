import { Alert, Button, Card, Col, Divider, Form, Input, Layout, List, Row, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { Agent, IdentityClaim, PortalAPI, AccountStatus, Session } from './PortalAPI';
import { PortalOAuth } from './PortalOAuth';

export function PortalApp() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [claim, setClaim] = useState<IdentityClaim | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const current = await PortalAPI.status();
    setStatus(current);

    if (current.organization) {
      setAgents(await PortalAPI.agents());
    }
  }

  useEffect(() => {
    async function initialize(): Promise<void> {
      try {
        const accessToken = await PortalOAuth.completeSignIn();
        setToken(accessToken);

        if (accessToken) {
          await refresh();
        }
      } catch (cause) {
        console.error('Portal login or initialization failed:', cause);
        setError(cause instanceof Error ? cause.message : 'Unable to load the Portal.');
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, []);

  async function action(work: () => Promise<void>): Promise<void> {
    setWorking(true);
    setError(null);

    try {
      await work();
    } catch (cause) {
      console.error('Organization Portal operation failed:', cause);
      setError(cause instanceof Error ? cause.message : 'The operation failed.');
    } finally {
      setWorking(false);
    }
  }

  async function selectAgent(agent: Agent): Promise<void> {
    await action(async () => {
      setSelectedAgent(agent);
      setSessions(await PortalAPI.sessions(agent.id));
      setClaim(null);
    });
  }

  function signOut(): void {
    PortalOAuth.signOut();
    setToken(null);
    setStatus(null);
    setAgents([]);
    setSelectedAgent(null);
    setClaim(null);
  }

  return (
    <Layout className="admin-layout">
      <Layout.Header className="admin-header">
        <Typography.Title level={4} className="admin-title">
          Agent Address · Organization Portal
        </Typography.Title>
      </Layout.Header>

      <Layout.Content className="admin-content">
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {error && <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />}

          {loading ? (
            <Spin />
          ) : !token ? (
            <Card title="Organization sign-in">
              <Typography.Paragraph>
                Sign in with your Agent Address email account to manage your Agents and Sessions.
              </Typography.Paragraph>
              <Button type="primary" onClick={() => void action(() => PortalOAuth.signIn())}>
                Sign in or create an account
              </Button>
            </Card>
          ) : (
            <>
              <Row justify="space-between" align="middle">
                <Col>
                  <Typography.Text type="secondary">{status?.account.email}</Typography.Text>
                </Col>
                <Col>
                  <Button onClick={signOut}>Sign out</Button>
                </Col>
              </Row>

              {!status?.organization ? (
                <Card title="Register your Organization">
                  <Form layout="vertical" onFinish={(values: { slug: string; displayName: string }) =>
                    void action(async () => {
                      await PortalAPI.registerOrganization(values.slug, values.displayName);
                      await refresh();
                    })}
                  >
                    <Form.Item label="Organization handle" name="slug" rules={[{ required: true }]}>
                      <Input placeholder="nuwa" />
                    </Form.Item>
                    <Form.Item label="Display name" name="displayName" rules={[{ required: true }]}>
                      <Input placeholder="Nuwa Information" />
                    </Form.Item>
                    <Button htmlType="submit" type="primary" loading={working}>Register Organization</Button>
                  </Form>
                </Card>
              ) : (
                <>
                  <Card title={status.organization.displayName}>
                    <Typography.Text type="secondary">
                      Organization: {status.organization.slug}
                    </Typography.Text>
                  </Card>

                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <Card title="Your Agents">
                        <List
                          dataSource={agents}
                          rowKey="id"
                          renderItem={(agent) => (
                            <List.Item
                              actions={[
                                <Button key={agent.id} onClick={() => void selectAgent(agent)}>
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
                        <Form layout="vertical" onFinish={(values: { agentName?: string; sessionName?: string }) =>
                          void action(async () => {
                            setClaim(await PortalAPI.createAgent(
                              values.agentName?.trim() ?? '',
                              values.sessionName?.trim() ?? '',
                            ));
                            await refresh();
                          })}
                        >
                          <Typography.Title level={5}>Create an Agent</Typography.Title>
                          <Form.Item name="agentName" label="Agent handle (optional)">
                            <Input placeholder="xiaoming" />
                          </Form.Item>
                          <Form.Item name="sessionName" label="Default Session handle (optional)">
                            <Input placeholder="main" />
                          </Form.Item>
                          <Button htmlType="submit" loading={working}>Create Agent</Button>
                        </Form>
                      </Card>
                    </Col>

                    <Col xs={24} md={12}>
                      <Card title={selectedAgent ? `Sessions: ${selectedAgent.handle}` : 'Sessions'}>
                        {selectedAgent ? (
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
                            <Form layout="vertical" onFinish={(values: { newSessionName?: string }) =>
                              void action(async () => {
                                setClaim(await PortalAPI.createSession(
                                  selectedAgent.id,
                                  values.newSessionName?.trim() ?? '',
                                ));
                                setSessions(await PortalAPI.sessions(selectedAgent.id));
                              })}
                            >
                              <Form.Item name="newSessionName" label="New Session handle (optional)">
                                <Input placeholder="ffl-dev" />
                              </Form.Item>
                              <Button htmlType="submit" loading={working}>Create Session</Button>
                            </Form>
                          </>
                        ) : (
                          <Typography.Text type="secondary">
                            Choose an Agent to inspect its Sessions.
                          </Typography.Text>
                        )}
                      </Card>
                    </Col>
                  </Row>

                  {claim && (
                    <Alert
                      type="success"
                      showIcon
                      message={'Created ' + claim.session.canonical}
                      description={
                        <div>
                          <p>Save these one-time secrets securely for this Session's Runtime.</p>
                          <p>Resume token: <code>{claim.resumeToken}</code></p>
                          <p>Runtime token: <code>{claim.runtimeToken}</code></p>
                        </div>
                      }
                    />
                  )}
                </>
              )}
            </>
          )}
        </Space>
      </Layout.Content>
    </Layout>
  );
}
