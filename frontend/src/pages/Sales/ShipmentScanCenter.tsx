import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CarOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  QrcodeOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { salesApi } from '../../api/sales';
import { shipmentsApi } from '../../api/shipments';
import { getToastMessage } from '../../shared/apiError';
import type {
  SalesOrderShipmentOverviewItem,
  SalesOrderShipmentPackageItem,
  ShipmentScanResolveResponse,
} from '../../types/sales';
import { canUseShipmentExecutionWorkspace } from '../../utils/authz';

const { Text, Title } = Typography;

type LoadingConfirmationValues = {
  loading_reference?: string;
  handover_receiver_name: string;
  handover_receiver_phone?: string;
  loading_confirmation_note?: string;
};

type DeliveryConfirmationValues = {
  delivery_reference?: string;
  customer_receiver_name: string;
  customer_receiver_phone?: string;
  delivered_at_actual?: string;
  delivery_confirmation_note?: string;
};

function packageStatusTag(pkg: SalesOrderShipmentPackageItem) {
  if (pkg.status === 'CANCELLED') {
    return <Tag color="error">Đã hủy</Tag>;
  }
  if (pkg.loaded_at) {
    return <Tag color="success">Đã bốc xếp</Tag>;
  }
  if (pkg.verified_at) {
    return <Tag color="processing">Đã xác minh</Tag>;
  }
  return <Tag color="default">Chờ quét</Tag>;
}

function buildShipmentSummary(
  shipment: SalesOrderShipmentOverviewItem | null,
  resolvedMeta: ShipmentScanResolveResponse | null,
) {
  return {
    shipmentCode: shipment?.shipment_code || resolvedMeta?.shipment_code || '-',
    shipmentStatus: shipment?.status || resolvedMeta?.shipment_status || '-',
    shipmentDate: shipment?.shipment_date || resolvedMeta?.shipment_date || null,
    orderCode: resolvedMeta?.order_code || '-',
    reference: shipment?.reference || resolvedMeta?.reference || '-',
    carrierName: shipment?.carrier_name || resolvedMeta?.carrier_name || '-',
    trackingNumber: shipment?.tracking_number || resolvedMeta?.tracking_number || '-',
    vehicleNo: shipment?.vehicle_no || resolvedMeta?.vehicle_no || '-',
    driverName: shipment?.driver_name || resolvedMeta?.driver_name || '-',
    driverPhone: shipment?.driver_phone || resolvedMeta?.driver_phone || '-',
    loadingReference: shipment?.loading_reference || resolvedMeta?.loading_reference || '-',
    handoverReceiverName: shipment?.handover_receiver_name || resolvedMeta?.handover_receiver_name || '-',
    handoverReceiverPhone: shipment?.handover_receiver_phone || resolvedMeta?.handover_receiver_phone || '-',
    loadingConfirmedAt: shipment?.loading_confirmed_at || resolvedMeta?.loading_confirmed_at || null,
    deliveryReference: shipment?.delivery_reference || resolvedMeta?.delivery_reference || '-',
    customerReceiverName: shipment?.customer_receiver_name || resolvedMeta?.customer_receiver_name || '-',
    customerReceiverPhone: shipment?.customer_receiver_phone || resolvedMeta?.customer_receiver_phone || '-',
    deliveryConfirmedAt: shipment?.delivery_confirmed_at || resolvedMeta?.delivery_confirmed_at || null,
  };
}

export default function ShipmentScanCenter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scanValue, setScanValue] = useState(searchParams.get('scan') || '');
  const [matchedBy, setMatchedBy] = useState<string | null>(null);
  const [matchedPackageId, setMatchedPackageId] = useState<number | null>(
    Number(searchParams.get('package_id') || 0) || null,
  );
  const [resolvedMeta, setResolvedMeta] = useState<ShipmentScanResolveResponse | null>(null);
  const [selectedPackageIds, setSelectedPackageIds] = useState<number[]>([]);
  const [loadingModalOpen, setLoadingModalOpen] = useState(false);
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [loadingForm] = Form.useForm<LoadingConfirmationValues>();
  const [deliveryForm] = Form.useForm<DeliveryConfirmationValues>();

  const contextOrderId = Number(searchParams.get('order_id') || 0) || null;
  const contextShipmentId = Number(searchParams.get('shipment_id') || 0) || null;
  const paramPackageId = Number(searchParams.get('package_id') || 0) || null;
  const canManageExecution = canUseShipmentExecutionWorkspace();

  const contextQuery = useQuery({
    queryKey: ['shipment-scan-context', contextOrderId, contextShipmentId],
    enabled: Boolean(contextOrderId && contextShipmentId),
    queryFn: async () => {
      const [packageOverview, shipmentOverview] = await Promise.all([
        salesApi.getShipmentPackageOverview(contextOrderId as number, contextShipmentId as number),
        salesApi.getShipmentOverview(contextOrderId as number),
      ]);
      const shipment = shipmentOverview.results.find(
        (item) => item.shipment_id === contextShipmentId,
      ) ?? null;
      return {
        shipment,
        packageOverview,
      };
    },
  });

  const packages = useMemo(
    () => contextQuery.data?.packageOverview.results ?? [],
    [contextQuery.data?.packageOverview.results],
  );
  const packageSummary = {
    packageCount: contextQuery.data?.packageOverview.package_count ?? resolvedMeta?.package_count ?? 0,
    verifiedCount: contextQuery.data?.packageOverview.verified_package_count ?? resolvedMeta?.verified_package_count ?? 0,
    loadedCount: contextQuery.data?.packageOverview.loaded_package_count ?? resolvedMeta?.loaded_package_count ?? 0,
    pendingVerifyCount: contextQuery.data?.packageOverview.pending_verify_count ?? resolvedMeta?.pending_verify_count ?? 0,
    pendingLoadCount: contextQuery.data?.packageOverview.pending_load_count ?? resolvedMeta?.pending_load_count ?? 0,
  };

  const focusedPackage = useMemo(() => {
    const activeMatchedPackageId = paramPackageId || matchedPackageId;
    if (activeMatchedPackageId) {
      const matched = packages.find((pkg) => pkg.id === activeMatchedPackageId);
      if (matched) return matched;
    }
    if (selectedPackageIds.length > 0) {
      const selected = packages.find((pkg) => pkg.id === selectedPackageIds[0]);
      if (selected) return selected;
    }
    return packages[0] ?? null;
  }, [matchedPackageId, packages, paramPackageId, selectedPackageIds]);

  const shipmentSummary = useMemo(
    () => buildShipmentSummary(contextQuery.data?.shipment ?? null, resolvedMeta),
    [contextQuery.data?.shipment, resolvedMeta],
  );

  useEffect(() => {
    if (!contextQuery.data?.shipment) return;
    loadingForm.setFieldsValue({
      loading_reference: contextQuery.data.shipment.loading_reference || '',
      handover_receiver_name: contextQuery.data.shipment.handover_receiver_name || '',
      handover_receiver_phone: contextQuery.data.shipment.handover_receiver_phone || '',
      loading_confirmation_note: contextQuery.data.shipment.loading_confirmation_note || '',
    });
    deliveryForm.setFieldsValue({
      delivery_reference: contextQuery.data.shipment.delivery_reference || '',
      customer_receiver_name: contextQuery.data.shipment.customer_receiver_name || '',
      customer_receiver_phone: contextQuery.data.shipment.customer_receiver_phone || '',
      delivered_at_actual: contextQuery.data.shipment.delivery_confirmed_at
        ? dayjs(contextQuery.data.shipment.delivery_confirmed_at).format('YYYY-MM-DDTHH:mm:ss')
        : dayjs().format('YYYY-MM-DDTHH:mm:ss'),
      delivery_confirmation_note: contextQuery.data.shipment.delivery_confirmation_note || '',
    });
  }, [contextQuery.data?.shipment, deliveryForm, loadingForm]);

  const reloadContext = async (nextMatchedPackageId?: number | null) => {
    if (!contextOrderId || !contextShipmentId) return;
    await queryClient.invalidateQueries({
      queryKey: ['shipment-scan-context', contextOrderId, contextShipmentId],
    });
    if (typeof nextMatchedPackageId === 'number') {
      setMatchedPackageId(nextMatchedPackageId);
      setSelectedPackageIds([nextMatchedPackageId]);
    }
  };

  const resolveMutation = useMutation({
    mutationFn: (payload: { scan_value: string }) => shipmentsApi.resolveScan(payload),
    onSuccess: (data) => {
      setResolvedMeta(data);
      setMatchedBy(data.matched_by || null);
      setMatchedPackageId(data.package.id);
      setSelectedPackageIds([data.package.id]);
      if (!data.order_id || !data.shipment_id) {
        messageApi.warning('Đã tìm thấy kiện nhưng chưa xác định đủ bối cảnh phiếu xuất.');
        return;
      }
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('order_id', String(data.order_id));
      nextParams.set('shipment_id', String(data.shipment_id));
      nextParams.set('package_id', String(data.package.id));
      if (scanValue.trim()) {
        nextParams.set('scan', scanValue.trim());
      }
      setSearchParams(nextParams, { replace: false });
      messageApi.success(`Đã tìm thấy kiện ${data.package.package_code}.`);
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không tra cứu được mã QR hoặc mã kiện.'));
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!contextOrderId || !contextShipmentId) {
        throw new Error('Thiếu ngữ cảnh phiếu xuất để xác minh kiện.');
      }
      const valueToScan = scanValue.trim()
        || focusedPackage?.label_qr_value
        || focusedPackage?.package_code;
      if (!valueToScan) {
        throw new Error('Chưa có mã quét để xác minh.');
      }
      return salesApi.scanShipmentPackage(contextOrderId, {
        shipment_id: contextShipmentId,
        scan_value: valueToScan,
      });
    },
    onSuccess: async (data) => {
      setResolvedMeta((prev) => (prev ? { ...prev, ...data, package: data.package, packages: prev.packages } : prev));
      setMatchedPackageId(data.package.id);
      setSelectedPackageIds([data.package.id]);
      await reloadContext(data.package.id);
      messageApi.success(
        data.scan_status === 'ALREADY_VERIFIED'
          ? `Kiện ${data.package.package_code} đã được xác minh trước đó.`
          : `Đã xác minh kiện ${data.package.package_code}.`,
      );
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không xác minh được kiện.'));
    },
  });

  const markLoadedMutation = useMutation({
    mutationFn: async () => {
      if (!contextOrderId || !contextShipmentId) {
        throw new Error('Thiếu ngữ cảnh phiếu xuất để bốc xếp.');
      }
      const packageIds = selectedPackageIds.length > 0
        ? selectedPackageIds
        : focusedPackage
          ? [focusedPackage.id]
          : undefined;
      return salesApi.markShipmentPackagesLoaded(contextOrderId, {
        shipment_id: contextShipmentId,
        package_ids: packageIds,
      });
    },
    onSuccess: async (data) => {
      await reloadContext(matchedPackageId);
      messageApi.success(`Đã xác nhận bốc xếp ${data.loaded_count} kiện.`);
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể xác nhận bốc xếp kiện.'));
    },
  });

  const loadingConfirmationMutation = useMutation({
    mutationFn: async (payload: LoadingConfirmationValues) => {
      if (!contextOrderId || !contextShipmentId) {
        throw new Error('Thiếu ngữ cảnh phiếu xuất để bàn giao xe.');
      }
      return salesApi.confirmShipmentLoading(contextOrderId, {
        shipment_id: contextShipmentId,
        loading_reference: payload.loading_reference?.trim() || '',
        handover_receiver_name: payload.handover_receiver_name.trim(),
        handover_receiver_phone: payload.handover_receiver_phone?.trim() || '',
        loading_confirmation_note: payload.loading_confirmation_note?.trim() || '',
      });
    },
    onSuccess: async () => {
      setLoadingModalOpen(false);
      await reloadContext(matchedPackageId);
      messageApi.success('Đã xác nhận bàn giao xe.');
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể xác nhận bàn giao xe.'));
    },
  });

  const deliveryConfirmationMutation = useMutation({
    mutationFn: async (payload: DeliveryConfirmationValues) => {
      if (!contextOrderId || !contextShipmentId) {
        throw new Error('Thiếu ngữ cảnh phiếu xuất để xác nhận giao xong.');
      }
      return salesApi.confirmShipmentDelivery(contextOrderId, {
        shipment_id: contextShipmentId,
        delivery_reference: payload.delivery_reference?.trim() || '',
        customer_receiver_name: payload.customer_receiver_name.trim(),
        customer_receiver_phone: payload.customer_receiver_phone?.trim() || '',
        delivered_at_actual: payload.delivered_at_actual || undefined,
        delivery_confirmation_note: payload.delivery_confirmation_note?.trim() || '',
      });
    },
    onSuccess: async () => {
      setDeliveryModalOpen(false);
      await reloadContext(matchedPackageId);
      messageApi.success('Đã xác nhận giao xong.');
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể xác nhận giao xong.'));
    },
  });

  const packageColumns: ColumnsType<SalesOrderShipmentPackageItem> = [
    {
      title: 'Kiện',
      width: 170,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.package_code}</Text>
          <Text type="secondary">{`${row.package_no}/${row.total_packages}`}</Text>
        </Space>
      ),
    },
    {
      title: 'Sản phẩm',
      width: 240,
      render: (_, row) => [row.product_code, row.product_name].filter(Boolean).join(' - ') || '-',
    },
    {
      title: 'Số lượng',
      dataIndex: 'quantity',
      width: 110,
    },
    {
      title: 'Trạng thái',
      width: 140,
      render: (_, row) => packageStatusTag(row),
    },
    {
      title: 'QR',
      dataIndex: 'label_qr_value',
      width: 260,
      render: (value: string) => <Text code>{value}</Text>,
    },
    {
      title: 'Tác vụ',
      key: 'actions',
      width: 180,
      render: (_, row) => (
        <Space wrap size="small">
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              setMatchedPackageId(row.id);
              setSelectedPackageIds([row.id]);
            }}
          >
            Chọn
          </Button>
          {canManageExecution ? (
            <Button
              size="small"
              type="primary"
              disabled={Boolean(row.loaded_at)}
              loading={verifyMutation.isPending && matchedPackageId === row.id}
              onClick={() => {
                setMatchedPackageId(row.id);
                setSelectedPackageIds([row.id]);
                setScanValue(row.label_qr_value || row.package_code);
                void verifyMutation.mutateAsync();
              }}
            >
              Xác minh
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const workspaceAlert = !canManageExecution
    ? {
        type: 'info' as const,
        message: 'Tài khoản hiện tại đang ở chế độ tra cứu QR. Bạn có thể xem trạng thái kiện nhưng không thể ghi nhận bốc xếp hay bàn giao.',
      }
    : {
        type: 'success' as const,
        message: 'Bạn có thể quét kiện, xác minh, bốc xếp, bàn giao xe và xác nhận giao xong ngay tại đây.',
      };

  const handleResolveScan = async () => {
    if (!scanValue.trim()) {
      messageApi.error('Vui lòng quét hoặc nhập mã kiện/QR.');
      return;
    }
    await resolveMutation.mutateAsync({ scan_value: scanValue.trim() });
  };

  const handleSubmitLoading = async () => {
    const values = await loadingForm.validateFields();
    await loadingConfirmationMutation.mutateAsync(values);
  };

  const handleSubmitDelivery = async () => {
    const values = await deliveryForm.validateFields();
    await deliveryConfirmationMutation.mutateAsync(values);
  };

  return (
    <div data-testid="shipment-scan-center" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}

      <Card bordered={false} style={{ borderRadius: 20 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">QR nhanh</Tag>
                <Tag color="processing">Phiếu xuất</Tag>
                <Tag color="gold">Điện thoại</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>
                Quét QR kiện
              </Title>
              <Text type="secondary">
                Đây là workspace thao tác nhanh cho kiện giao hàng. Có thể tra cứu trạng thái kiện, xác minh, bốc xếp, bàn giao xe và xác nhận giao xong từ một nơi.
              </Text>
            </div>
            <Space wrap>
              <Button onClick={() => navigate('/shipments')}>Mở Phiếu xuất</Button>
              <Button onClick={() => navigate('/sales-orders?section=delivery-planning')}>
                Mở kế hoạch giao hàng
              </Button>
            </Space>
          </div>

          <Alert showIcon type={workspaceAlert.type} message={workspaceAlert.message} />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input
              data-testid="shipment-scan-input"
              prefix={<QrcodeOutlined />}
              placeholder="Quét QR hoặc nhập mã kiện"
              value={scanValue}
              onChange={(event) => setScanValue(event.target.value)}
              onPressEnter={() => void handleResolveScan()}
              style={{ minWidth: 280, flex: '1 1 320px' }}
            />
            <Button
              data-testid="shipment-scan-resolve-button"
              type="primary"
              icon={<SearchOutlined />}
              loading={resolveMutation.isPending}
              onClick={() => void handleResolveScan()}
            >
              Tra cứu kiện
            </Button>
            {canManageExecution ? (
              <Button
                data-testid="shipment-scan-verify-button"
                icon={<CheckCircleOutlined />}
                disabled={!contextOrderId || !contextShipmentId || !focusedPackage}
                loading={verifyMutation.isPending}
                onClick={() => void verifyMutation.mutateAsync()}
              >
                Xác minh kiện
              </Button>
            ) : null}
          </div>
        </Space>
      </Card>

      {!contextOrderId || !contextShipmentId ? (
        <Card bordered={false} style={{ borderRadius: 18 }}>
          <Empty
            description="Quét một mã kiện hoặc QR để mở đúng phiếu xuất và tiếp tục thao tác."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </Card>
      ) : contextQuery.isLoading ? (
        <Card bordered={false} style={{ borderRadius: 18 }}>
          <Skeleton active paragraph={{ rows: 10 }} />
        </Card>
      ) : (
        <>
          <Card bordered={false} style={{ borderRadius: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Card size="small">
                <Statistic title="Tổng kiện hiệu lực" value={packageSummary.packageCount} />
              </Card>
              <Card size="small">
                <Statistic title="Đã xác minh" value={packageSummary.verifiedCount} />
              </Card>
              <Card size="small">
                <Statistic title="Đã bốc xếp" value={packageSummary.loadedCount} />
              </Card>
              <Card size="small">
                <Statistic title="Chờ bốc xếp" value={packageSummary.pendingLoadCount} />
              </Card>
            </div>
          </Card>

          <Card bordered={false} style={{ borderRadius: 18 }}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <Title level={4} style={{ margin: 0 }}>
                    {shipmentSummary.shipmentCode}
                  </Title>
                  <Text type="secondary">
                    {shipmentSummary.orderCode !== '-' ? `Đơn hàng: ${shipmentSummary.orderCode}` : 'Chưa gắn được đơn hàng'}
                    {matchedBy ? ` • Khớp theo ${matchedBy === 'label_qr_value' ? 'giá trị QR' : 'mã kiện'}` : ''}
                  </Text>
                </div>
                <Space wrap>
                  <Button
                    onClick={() =>
                      navigate(`/sales-orders?focus_id=${contextOrderId}&section=delivery-planning`)
                    }
                  >
                    Về Đơn hàng xuất
                  </Button>
                  <Button
                    onClick={() =>
                      navigate(`/shipments?focus_id=${contextShipmentId}&order_id=${contextOrderId}`)
                    }
                  >
                    Về Phiếu xuất
                  </Button>
                </Space>
              </div>

              <Descriptions
                bordered
                size="small"
                column={2}
                items={[
                  { key: 'status', label: 'Trạng thái phiếu', children: shipmentSummary.shipmentStatus },
                  {
                    key: 'date',
                    label: 'Ngày giao',
                    children: shipmentSummary.shipmentDate ? dayjs(shipmentSummary.shipmentDate).format('DD/MM/YYYY') : '-',
                  },
                  { key: 'reference', label: 'Tham chiếu', children: shipmentSummary.reference },
                  { key: 'carrier', label: 'Nhà vận chuyển', children: shipmentSummary.carrierName },
                  { key: 'tracking', label: 'Mã vận chuyển', children: shipmentSummary.trackingNumber },
                  { key: 'vehicle', label: 'Xe giao', children: shipmentSummary.vehicleNo },
                  { key: 'driver', label: 'Tài xế', children: shipmentSummary.driverName },
                  { key: 'driver_phone', label: 'SĐT tài xế', children: shipmentSummary.driverPhone },
                  { key: 'loading_reference', label: 'Mã bàn giao xe', children: shipmentSummary.loadingReference },
                  { key: 'handover_receiver', label: 'Người nhận xe', children: shipmentSummary.handoverReceiverName },
                  { key: 'delivery_reference', label: 'Mã giao hàng', children: shipmentSummary.deliveryReference },
                  { key: 'customer_receiver', label: 'Người nhận cuối', children: shipmentSummary.customerReceiverName },
                ]}
              />

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {canManageExecution ? (
                  <>
                    <Button
                      type="primary"
                      icon={<CheckCircleOutlined />}
                      disabled={!focusedPackage || Boolean(focusedPackage.loaded_at)}
                      loading={verifyMutation.isPending}
                      onClick={() => void verifyMutation.mutateAsync()}
                    >
                      Xác minh kiện đang chọn
                    </Button>
                    <Button
                      icon={<CarOutlined />}
                      disabled={packageSummary.pendingLoadCount <= 0}
                      loading={markLoadedMutation.isPending}
                      onClick={() => void markLoadedMutation.mutateAsync()}
                    >
                      Xác nhận bốc xếp
                    </Button>
                    <Button
                      disabled={packageSummary.packageCount <= 0 || Boolean(contextQuery.data?.shipment?.loading_confirmed_at)}
                      onClick={() => setLoadingModalOpen(true)}
                    >
                      Bàn giao xe
                    </Button>
                    <Button
                      disabled={!contextQuery.data?.shipment?.loading_confirmed_at || Boolean(contextQuery.data?.shipment?.delivery_confirmed_at)}
                      onClick={() => setDeliveryModalOpen(true)}
                    >
                      Xác nhận giao xong
                    </Button>
                  </>
                ) : (
                  <Tag color="blue">Chế độ tra cứu</Tag>
                )}
                {contextQuery.data?.shipment?.loading_confirmed_at ? (
                  <Tag color="success">
                    Đã bàn giao xe lúc {dayjs(contextQuery.data.shipment.loading_confirmed_at).format('DD/MM HH:mm')}
                  </Tag>
                ) : null}
                {contextQuery.data?.shipment?.delivery_confirmed_at ? (
                  <Tag color="success">
                    Đã giao xong lúc {dayjs(contextQuery.data.shipment.delivery_confirmed_at).format('DD/MM HH:mm')}
                  </Tag>
                ) : null}
              </div>
            </Space>
          </Card>

          <Card bordered={false} style={{ borderRadius: 18 }}>
            <Table<SalesOrderShipmentPackageItem>
              rowKey="id"
              columns={packageColumns}
              dataSource={packages}
              pagination={false}
              scroll={{ x: 1300 }}
              rowSelection={
                canManageExecution
                  ? {
                      selectedRowKeys: selectedPackageIds,
                      onChange: (keys) => setSelectedPackageIds(keys.map((item) => Number(item))),
                    }
                  : undefined
              }
              rowClassName={(row) => (row.id === matchedPackageId ? 'erp-table-row-highlight' : '')}
              locale={{ emptyText: 'Phiếu xuất này chưa có kiện để quét.' }}
            />
          </Card>
        </>
      )}

      <Modal
        title="Bàn giao xe"
        open={loadingModalOpen}
        onCancel={() => setLoadingModalOpen(false)}
        onOk={() => void handleSubmitLoading()}
        confirmLoading={loadingConfirmationMutation.isPending}
        okText="Xác nhận bàn giao"
        cancelText="Đóng"
      >
        <Form form={loadingForm} layout="vertical">
          <Form.Item label="Mã bàn giao" name="loading_reference">
            <Input />
          </Form.Item>
          <Form.Item
            label="Người nhận xe"
            name="handover_receiver_name"
            rules={[{ required: true, message: 'Vui lòng nhập người nhận xe.' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="SĐT người nhận xe" name="handover_receiver_phone">
            <Input />
          </Form.Item>
          <Form.Item label="Ghi chú" name="loading_confirmation_note">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Xác nhận giao xong"
        open={deliveryModalOpen}
        onCancel={() => setDeliveryModalOpen(false)}
        onOk={() => void handleSubmitDelivery()}
        confirmLoading={deliveryConfirmationMutation.isPending}
        okText="Xác nhận giao xong"
        cancelText="Đóng"
      >
        <Form form={deliveryForm} layout="vertical">
          <Form.Item label="Mã biên bản giao hàng" name="delivery_reference">
            <Input />
          </Form.Item>
          <Form.Item
            label="Người nhận hàng"
            name="customer_receiver_name"
            rules={[{ required: true, message: 'Vui lòng nhập người nhận hàng.' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="SĐT người nhận" name="customer_receiver_phone">
            <Input />
          </Form.Item>
          <Form.Item label="Thời điểm giao xong" name="delivered_at_actual">
            <Input placeholder="YYYY-MM-DDTHH:mm:ss" />
          </Form.Item>
          <Form.Item label="Ghi chú" name="delivery_confirmation_note">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
