import { Alert, Button, Form, Input, Modal, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';

import type { Session } from './PortalAPI';
import { WakeEndpointAPI, type WakeEndpoint } from './WakeEndpointAPI';

type Fields = { callbackUrl: string };

export function WakeEndpointEditor({
  session, onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const [form] = Form.useForm<Fields>();
  const [endpoint, setEndpoint] = useState<WakeEndpoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;

    void WakeEndpointAPI.get(session.id).then((value) => {
      if (active) {
        setEndpoint(value);
      }
    }).catch((cause: unknown) => {
      if (active) {
        setError(cause instanceof Error ? cause.message : 'Unable to load the Wake receiver.');
      }
    }).finally(() => {
      if (active) {
        setLoading(false);
      }
    });

    return () => { active = false; };
  }, [session.id]);

  async function save(fields: Fields): Promise<void> {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const updated = await WakeEndpointAPI.update(session.id, fields.callbackUrl);
      setEndpoint(updated);
      setSaved(true);
      form.resetFields();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update the Wake receiver.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={'Wake receiver URL · ' + session.canonical}
      onCancel={onClose} footer={null} destroyOnHidden>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {loading ? <Spin /> : (
          <>
            {error && <Alert showIcon type="error" message={error} />}
            {endpoint && (
              <>
                <Typography.Paragraph>
                  Current receiver: <Typography.Text strong>{endpoint.callbackHost}</Typography.Text>
                  {' · '}{endpoint.authMode} authentication
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary">
                  Paste the new HTTPS Tunnel hostname to preserve the existing
                  private Webhook path and encrypted key. Paste a full Webhook URL
                  when the Automation path itself has changed. Your Agent,
                  Session, Wake authorization, coworkers and native Threads stay the same.
                </Typography.Paragraph>
                {saved && <Alert type="success" showIcon message="Wake URL updated. The existing authentication key was preserved." />}
                <Form form={form} layout="vertical" onFinish={(fields: Fields) => void save(fields)}>
                  <Form.Item name="callbackUrl" label="New Tunnel or Webhook HTTPS URL"
                    rules={[{ required: true, type: 'url', message: 'Enter a public HTTPS URL.' }]}>
                    <Input placeholder="https://new-tunnel.trycloudflare.com" autoComplete="off" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={saving}>
                    Save Wake URL
                  </Button>
                </Form>
              </>
            )}
          </>
        )}
        <Button onClick={onClose}>Close Wake editor</Button>
      </Space>
    </Modal>
  );
}
