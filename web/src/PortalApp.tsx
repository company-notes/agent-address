import { Alert, Button, Card, Col, Layout, Row, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';

import type {
  AccountStatus,
  Agent,
  AgentChanges,
  IdentityRegistration,
  Session,
  SessionChanges,
} from './PortalAPI';
import { PortalAPI } from './PortalAPI';
import { EditingIdentity, PortalEditor } from './PortalEditor';
import { PortalOAuth } from './PortalOAuth';
import {
  AgentRegistryCard,
  IdentitySecretNotice,
  OrganizationOverviewCard,
  OrganizationRegistrationCard,
  SessionRegistryCard,
} from './PortalSections';
import type { AgentFields, OrganizationFields, SessionFields } from './PortalSections';

type SecretNotice = {
  identity: IdentityRegistration;
  rotated: boolean;
};

export function PortalApp() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [secret, setSecret] = useState<SecretNotice | null>(null);
  const [editing, setEditing] = useState<EditingIdentity | null>(null);
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
      setSessions(await PortalAPI.sessions(agent.id));
      setSelectedAgent(agent);
      setSecret(null);
    });
  }

  async function registerOrganization(fields: OrganizationFields): Promise<void> {
    await action(async () => {
      await PortalAPI.registerOrganization(fields.slug, fields.displayName);
      await refresh();
    });
  }

  async function updateOrganization(displayName: string): Promise<void> {
    await action(async () => {
      await PortalAPI.updateOrganization(displayName.trim());
      await refresh();
    });
  }

  async function createAgent(fields: AgentFields): Promise<void> {
    await action(async () => {
      const identity = await PortalAPI.createAgent(
        fields.agentName?.trim() ?? '',
        fields.sessionName?.trim() ?? '',
        fields.agentDisplayName?.trim() ?? '',
        fields.sessionDisplayName?.trim() ?? '',
      );
      setSecret({ identity, rotated: false });

      await refresh();
    });
  }

  async function updateAgent(agentID: string, changes: AgentChanges): Promise<void> {
    await action(async () => {
      const updated = await PortalAPI.updateAgent(agentID, changes);
      setEditing(null);

      if (selectedAgent?.id === agentID) {
        setSelectedAgent(updated);
        setSessions(await PortalAPI.sessions(agentID));
      }

      await refresh();
    });
  }

  async function archiveAgent(agentID: string): Promise<void> {
    await action(async () => {
      await PortalAPI.archiveAgent(agentID);

      if (selectedAgent?.id === agentID) {
        setSelectedAgent(null);
        setSessions([]);
      }

      setSecret(null);
      await refresh();
    });
  }

  async function createSession(agentID: string, fields: SessionFields): Promise<void> {
    await action(async () => {
      const identity = await PortalAPI.createSession(
        agentID,
        fields.newSessionName?.trim() ?? '',
        fields.newSessionDisplayName?.trim() ?? '',
      );
      setSecret({ identity, rotated: false });

      setSessions(await PortalAPI.sessions(agentID));
    });
  }

  async function updateSession(sessionID: string, changes: SessionChanges): Promise<void> {
    await action(async () => {
      const updated = await PortalAPI.updateSession(sessionID, changes);
      setEditing(null);
      setSessions(await PortalAPI.sessions(updated.agentId));
      await refresh();
    });
  }

  async function setDefaultSession(sessionID: string): Promise<void> {
    await action(async () => {
      const updated = await PortalAPI.setDefaultSession(sessionID);
      setSessions(await PortalAPI.sessions(updated.agentId));
      await refresh();
    });
  }

  async function archiveSession(sessionID: string): Promise<void> {
    await action(async () => {
      await PortalAPI.archiveSession(sessionID);

      if (selectedAgent) {
        setSessions(await PortalAPI.sessions(selectedAgent.id));
      }

      setSecret(null);
    });
  }

  async function rotateResumeToken(sessionID: string): Promise<void> {
    await action(async () => {
      const result = await PortalAPI.rotateResumeToken(sessionID);
      const session = await PortalAPI.getSession(sessionID);
      setSecret({ identity: { session, resumeToken: result.resumeToken }, rotated: true });
    });
  }

  function signOut(): void {
    PortalOAuth.signOut();
    setToken(null);
    setStatus(null);
    setAgents([]);
    setSessions([]);
    setSelectedAgent(null);
    setEditing(null);
    setSecret(null);
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
                  <OrganizationOverviewCard
                    organization={status.organization}
                    loading={working}
                    onUpdate={(displayName) => void updateOrganization(displayName)}
                  />

                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <AgentRegistryCard
                        agents={agents}
                        loading={working}
                        onSelect={(agent) => void selectAgent(agent)}
                        onCreate={(fields) => void createAgent(fields)}
                        onEdit={setEditingAgent}
                        onArchive={(agentID) => void archiveAgent(agentID)}
                      />
                    </Col>

                    <Col xs={24} md={12}>
                      <SessionRegistryCard
                        agent={selectedAgent}
                        sessions={sessions}
                        loading={working}
                        onCreate={(agentID, fields) => void createSession(agentID, fields)}
                        onEdit={(session) => setEditing({ kind: 'session', session })}
                        onDefault={(sessionID) => void setDefaultSession(sessionID)}
                        onArchive={(sessionID) => void archiveSession(sessionID)}
                        onRotate={(sessionID) => void rotateResumeToken(sessionID)}
                      />
                    </Col>
                  </Row>

                  {secret && (
                    <IdentitySecretNotice
                      identity={secret.identity}
                      rotated={secret.rotated}
                      onClose={() => setSecret(null)}
                    />
                  )}

                  {editing && (
                    <PortalEditor
                      target={editing}
                      loading={working}
                      onCancel={() => setEditing(null)}
                      onSaveAgent={(id, changes) => void updateAgent(id, changes)}
                      onSaveSession={(id, changes) => void updateSession(id, changes)}
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

  function setEditingAgent(agent: Agent): void {
    setEditing({ kind: 'agent', agent });
  }
}
