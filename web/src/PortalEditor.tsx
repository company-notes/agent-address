import { Button, Form, Input, Modal } from 'antd';

import type { Agent, AgentChanges, Session, SessionChanges } from './PortalAPI';
import { usePortalLanguage } from './PortalLanguage';

export type EditingIdentity =
  | { kind: 'agent'; agent: Agent }
  | { kind: 'session'; session: Session };

type EditFields = {
  handle: string;
  displayName: string;
};

export function PortalEditor({
  target,
  loading,
  onCancel,
  onSaveAgent,
  onSaveSession,
}: {
  target: EditingIdentity;
  loading: boolean;
  onCancel: () => void;
  onSaveAgent: (agentID: string, changes: AgentChanges) => void;
  onSaveSession: (sessionID: string, changes: SessionChanges) => void;
}) {
  const { t } = usePortalLanguage();
  const agent = target.kind === 'agent';
  const item = agent ? target.agent : target.session;
  const title = agent ? t('Edit Agent') : t('Edit Session');

  function save(fields: EditFields): void {
    const handle = fields.handle.trim();
    const displayName = fields.displayName.trim() || null;

    if (target.kind === 'agent') {
      onSaveAgent(target.agent.id, { agentName: handle, agentDisplayName: displayName });

      return;
    }

    onSaveSession(target.session.id, { sessionName: handle, sessionDisplayName: displayName });
  }

  return (
    <Modal open title={title} footer={null} onCancel={onCancel} destroyOnHidden>
      <Form
        key={item.id}
        layout="vertical"
        onFinish={save}
        initialValues={{ handle: item.handle, displayName: item.displayName ?? '' }}
      >
        <Form.Item
          name="handle"
          label={agent ? t('Agent address handle') : t('Session address handle')}
          rules={[{ required: true, message: t('An address handle is required.') }]}
        >
          <Input aria-label={t('Edit address handle')} />
        </Form.Item>

        <Form.Item name="displayName" label={t('Display name')}>
          <Input aria-label={t('Edit display name')} />
        </Form.Item>

        <p>{t('Changing a handle changes the canonical address immediately. Old addresses will not be aliased.')}</p>

        <Button type="primary" htmlType="submit" loading={loading}>
          {t('Save changes')}
        </Button>
      </Form>
    </Modal>
  );
}
