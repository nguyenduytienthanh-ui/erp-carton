import { useMemo } from 'react';
import { Button, Form, Input, Select, Space, Tag, Typography } from 'antd';
import type { NamePath } from 'antd/es/form/interface';
import { useQuery } from '@tanstack/react-query';

import { salesApi } from '../../api/sales';
import type { DeliveryCarrier } from '../../types/sales';

const { Text } = Typography;

type DeliveryCarrierFieldProps = {
  label: string;
  carrierIdName: NamePath;
  carrierNameName: NamePath;
  carrierIdWatchName?: NamePath;
  carrierNameWatchName?: NamePath;
  selectPlaceholder?: string;
  freeTextLabel?: string;
  freeTextPlaceholder?: string;
  selectTestId?: string;
  freeTextTestId?: string;
  warningTestId?: string;
  disabled?: boolean;
};

function normalizeId(value: unknown): number | null {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function DeliveryCarrierField({
  label,
  carrierIdName,
  carrierNameName,
  carrierIdWatchName,
  carrierNameWatchName,
  selectPlaceholder = 'Chọn đơn vị vận chuyển',
  freeTextLabel = 'Tên ngoài danh mục',
  freeTextPlaceholder = 'Nhập đơn vị vận chuyển ngoài danh mục',
  selectTestId,
  freeTextTestId,
  warningTestId,
  disabled = false,
}: DeliveryCarrierFieldProps) {
  const form = Form.useFormInstance();
  const carrierIdFieldPath = carrierIdWatchName ?? carrierIdName;
  const carrierNameFieldPath = carrierNameWatchName ?? carrierNameName;
  const carrierId = normalizeId(Form.useWatch(carrierIdFieldPath, form));
  const carrierName = String(Form.useWatch(carrierNameFieldPath, form) ?? '').trim();

  const carriersQuery = useQuery({
    queryKey: ['delivery-carriers', 'field-options'],
    queryFn: () => salesApi.getDeliveryCarriers({ page_size: 500, ordering: 'sort_order,name' }),
  });

  const carriers = useMemo<DeliveryCarrier[]>(
    () => carriersQuery.data?.results ?? [],
    [carriersQuery.data?.results],
  );

  const selectedCarrier = useMemo(
    () => carriers.find((item) => item.id === carrierId) ?? null,
    [carrierId, carriers],
  );

  const options = useMemo(
    () =>
      carriers
        .filter((item) => item.is_active || item.id === carrierId)
        .map((item) => ({
          value: item.id,
          label: `${item.code} - ${item.name}`,
        })),
    [carrierId, carriers],
  );

  const outsideCatalog = !selectedCarrier && carrierName.length > 0;

  const handleCarrierChange = (value: number | string | null) => {
    const nextCarrierId = normalizeId(value);
    const nextCarrier = carriers.find((item) => item.id === nextCarrierId) ?? null;
    form.setFieldValue(carrierIdFieldPath, nextCarrierId);
    form.setFieldValue(carrierNameFieldPath, nextCarrier ? nextCarrier.name : '');
  };

  const switchToOutsideCatalog = () => {
    form.setFieldValue(carrierIdFieldPath, null);
    if (selectedCarrier) {
      form.setFieldValue(carrierNameFieldPath, selectedCarrier.name);
    }
  };

  return (
    <>
      <Form.Item name={carrierIdName} label={label}>
        <Select
          data-testid={selectTestId}
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder={selectPlaceholder}
          options={options}
          loading={carriersQuery.isLoading}
          disabled={disabled}
          onChange={handleCarrierChange}
        />
      </Form.Item>

      <Form.Item name={carrierNameName} hidden>
        <Input type="hidden" />
      </Form.Item>

      {selectedCarrier ? (
        <Space size={8} wrap style={{ marginTop: -8, marginBottom: 12 }}>
          <Tag color={selectedCarrier.is_internal ? 'blue' : 'green'}>
            {selectedCarrier.is_internal ? 'Nội bộ' : 'Bên ngoài'}
          </Tag>
          <Text type="secondary">Sẽ lưu snapshot theo tên hiện tại: {selectedCarrier.name}</Text>
          {!disabled ? (
            <Button type="link" size="small" onClick={switchToOutsideCatalog}>
              Nhập ngoài danh mục
            </Button>
          ) : null}
        </Space>
      ) : (
        <Form.Item label={freeTextLabel} style={{ marginTop: -8 }}>
          <Input
            data-testid={freeTextTestId}
            value={carrierName}
            onChange={(event) => form.setFieldValue(carrierNameFieldPath, event.target.value)}
            disabled={disabled}
            placeholder={freeTextPlaceholder}
          />
        </Form.Item>
      )}

      {outsideCatalog ? (
        <div data-testid={warningTestId} style={{ marginTop: selectedCarrier ? 0 : -8, marginBottom: 12 }}>
          <Tag color="warning">Ngoài danh mục</Tag>
          <Text type="secondary">Tên này chưa nằm trong danh mục đơn vị vận chuyển.</Text>
        </div>
      ) : null}
    </>
  );
}
