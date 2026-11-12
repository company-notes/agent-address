import { Alert, Button, Card, Col, Layout, Row, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';

import type { AccountStatus, Agent, IdentityRegistration, Session } from './PortalAPI';
import { PortalAPI } from './PortalAPI';
import { PortalOAuth } from './PortalOAuth';
import {
  AgentRegistryCard,
  IdentityCreatedNotice,
  OrganizationRegistrationCard,
  SessionRegistryCard,
} from './PortalSections';
import type { AgentFields, OrganizationFields, SessionFields } from './PortalSections';

export function PortalApp() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [identity, setIdentity] = useState<IdentityRegistration | null>(null);
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
      setIdentity(null);
    });
  }

  async function registerOrganization(fields: OrganizationFields): Promise<void> {
    await action(async () => {
      await PortalAPI.registerOrganization(fields.slug, fields.displayName);
      await refresh();
    });
  }

  async function createAgent(fields: AgentFields): Promise<void> {
    await action(async () => {
      setIdentity(await PortalAPI.createAgent(
        fields.agentName?.trim() ?? '',
        fields.sessionName?.trim() ?? '',
      ));

      await refresh();
    });
  }

  async function createSession(fields: SessionFields): Promise<void> {
    if (!selectedAgent) {
      throw new Error('Select an Agent before creating a Session.');
    }

    await action(async () => {
      setIdentity(await PortalAPI.createSession(
        selectedAgent.id,
        fields.newSessionName?.trim() ?? '',
      ));

      setSessions(await PortalAPI.sessions(selectedAgent.id));
    });
  }

  function signOut(): void {
    PortalOAuth.signOut();
    setToken(null);
    setStatus(null);
    setAgents([]);
    setSessions([]);
    setSelectedAgent(null);
    setIdentity(null);
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
          {error && (
            <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />
          )}

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
                <OrganizationRegistrationCard
                  loading={working}
                  onRegister={(fields) => void registerOrganization(fields)}
                />
              ) : (
                <>
                  <Card title={status.organization.displayName}>
                    <Typography.Text type="secondary">
                      Organization: {status.organization.slug}
                    </Typography.Text>
                  </Card>

                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <AgentRegistryCard
                        agents={agents}
                        loading={working}
                        onSelect={(agent) => void selectAgent(agent)}
                        onCreate={(fields) => void createAgent(fields)}
                      />
                    </Col>

                    <Col xs={24} md={12}>
                      <SessionRegistryCard
                        agent={selectedAgent}
                        sessions={sessions}
                        loading={working}
                        onCreate={(fields) => void createSession(fields)}
                      />
                    </Col>
                  </Row>

                  {identity && <IdentityCreatedNotice identity={identity} />}
                </>
              )}
            </>
          )}
        </Space>
      </Layout.Content>
    </Layout>
  );
}
