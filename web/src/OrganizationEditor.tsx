import { Button, Form, Input, Typography } from 'antd';

import { usePortalLanguage } from './PortalLanguage';

export type OrganizationFields = { slug: string; displayName: string };

export function OrganizationEditor({
  organization,
  loading,
  onSave,
}: {
  organization: OrganizationFields;
  loading: boolean;
  onSave: (fields: OrganizationFields) => void;
}) {
  const { t } = usePortalLanguage();

  return (
    <Form
      key={organization.slug + ':' + organization.displayName}
      layout="vertical"
      initialValues={organization}
      onFinish={onSave}
    >
      <Form.Item name="slug" label={t("Organization handle")} rules={[
        { required: true, max: 63, pattern: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/ },
      ]}>
        <Input aria-label={t("Organization handle")} maxLength={63} />
      </Form.Item>

      <Form.Item name="displayName" label={t("Display name")} rules={[{ required: true, max: 120 }]}>
        <Input aria-label={t("Organization display name")} maxLength={120} />
      </Form.Item>

      <Typography.Paragraph type="secondary">
        {t('Changing the address handle keeps the same Agents and Sessions. Previous handles remain reserved for this Organization.')}
      </Typography.Paragraph>

      <Button htmlType="submit" loading={loading}>{t('Save Organization')}</Button>
    </Form>
  );
}
