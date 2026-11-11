import { Button, Form, Input, message, Typography } from 'antd';
import { useState } from 'react';

import { adminAPI } from './AdminDataProvider';

type PasswordFields = {
  password: string;
  confirmPassword: string;
};

export function PasswordResetForm({ accountId }: { accountId: string }) {
  const [form] = Form.useForm<PasswordFields>();
  const [submitting, setSubmitting] = useState(false);
  const [messageAPI, contextHolder] = message.useMessage();

  async function submit(values: PasswordFields) {
    setSubmitting(true);

    try {
      await adminAPI.resetPassword(accountId, values.password);
      form.resetFields();
      messageAPI.success('Password updated. Existing Agent Address authorizations are no longer valid.');
    } catch (error) {
      console.error('Admin password reset failed:', error);
      messageAPI.error(error instanceof Error ? error.message : 'Password reset failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      {contextHolder}

      <Typography.Title level={5}>Reset password</Typography.Title>
      <Typography.Paragraph type="secondary">
        This action invalidates existing Agent Address account authorizations.
        It does not display stored passwords.
      </Typography.Paragraph>

      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item
          label="New password"
          name="password"
          rules={[{ required: true, min: 10 }]}
        >
          <Input.Password autoComplete="new-password" maxLength={256} />
        </Form.Item>

        <Form.Item
          label="Confirm new password"
          name="confirmPassword"
          dependencies={['password']}
          rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (value === getFieldValue('password')) {
                  return Promise.resolve();
                }

                return Promise.reject(new Error('Passwords do not match.'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" maxLength={256} />
        </Form.Item>

        <Button htmlType="submit" type="primary" danger loading={submitting}>
          Reset password
        </Button>
      </Form>
    </section>
  );
}
