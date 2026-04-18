import { useCallback, useEffect, useRef, useState } from 'react';
import type { InputRef } from 'antd';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Row,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CameraOutlined,
  ClearOutlined,
  CopyOutlined,
  HistoryOutlined,
  LoadingOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  RightOutlined,
  StopOutlined,
} from '@ant-design/icons';
import QrScanner from 'qr-scanner';
import { useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { productionApi } from '../../api/production';
import { shipmentsApi } from '../../api/shipments';
import PageHeader from '../../components/PageHeader/PageHeader';
import { prefersDesktopScannerUi } from '../../utils/inputDevices';
import { appendScanCenterContext, readScanCenterOrigin } from '../../utils/scanNavigation';
import type { ShipmentScanResolveResponse } from '../../types/sales';
import type { ProductionOrder, ProductionOrderStatus } from '../../types/production';

const { Text } = Typography;

// ── Types ──────────────────────────────────────────────────────────────────────

type ScanDomain = 'SHIPMENT' | 'PRODUCTION_ORDER' | 'NOT_FOUND';

interface ScanResult {
  domain: ScanDomain;
  scanValue: string;
  shipment?: ShipmentScanResolveResponse;
  productionOrder?: ProductionOrder;
}

interface ScanHistoryEntry {
  id: string;
  scanValue: string;
  timestamp: string;
  domain: ScanDomain;
  label: string;
  navigateTo?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  PACKED: 'Đã đóng gói',
  SENT: 'Đang giao',
  DELIVERED: 'Đã giao',
  CANCELLED: 'Đã hủy',
};

const SHIPMENT_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'blue',
  PACKED: 'cyan',
  SENT: 'gold',
  DELIVERED: 'success',
  CANCELLED: 'error',
};

const PRODUCTION_STATUS_LABELS: Record<ProductionOrderStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  RELEASED: 'Đã phát lệnh',
  IN_PROGRESS: 'Đang sản xuất',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};

const PRODUCTION_STATUS_COLORS: Record<ProductionOrderStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'blue',
  REJECTED: 'error',
  RELEASED: 'cyan',
  IN_PROGRESS: 'gold',
  COMPLETED: 'success',
  CANCELLED: 'magenta',
};

const MAX_HISTORY = 20;

// ── Main component ─────────────────────────────────────────────────────────────

export default function ScanCenter() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [messageApi, contextHolder] = message.useMessage();

  const [scanInput, setScanInput] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isDesktopMode] = useState(() => prefersDesktopScannerUi());

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const inputRef = useRef<InputRef>(null);

  // origin context (were we navigated here from within the app?)
  const scanOrigin = readScanCenterOrigin(searchParams);

  // ── Resolve mutation ───────────────────────────────────────────────────────

  const resolveMutation = useMutation({
    mutationFn: async (scanValue: string): Promise<ScanResult> => {
      const trimmed = scanValue.trim();
      if (!trimmed) throw new Error('Vui lòng nhập giá trị cần tra cứu.');

      // 1. Try shipment package resolve
      try {
        const shipResult = await shipmentsApi.resolveScan({ scan_value: trimmed });
        if (shipResult.shipment_id) {
          return { domain: 'SHIPMENT', scanValue: trimmed, shipment: shipResult };
        }
      } catch {
        // not a shipment QR — continue to next domain
      }

      // 2. Try production order lookup by code
      try {
        const prodResult = await productionApi.getOrders({ search: trimmed, page_size: 1 });
        if (prodResult.results.length > 0) {
          return { domain: 'PRODUCTION_ORDER', scanValue: trimmed, productionOrder: prodResult.results[0] };
        }
      } catch {
        // ignore
      }

      return { domain: 'NOT_FOUND', scanValue: trimmed };
    },
    onSuccess: (res) => {
      setResult(res);
      setScanInput(res.scanValue);
      const navPath =
        res.domain === 'SHIPMENT' && res.shipment?.shipment_id
          ? `/shipments?focus_id=${res.shipment.shipment_id}`
          : res.domain === 'PRODUCTION_ORDER' && res.productionOrder?.id
            ? `/production-orders?focus_id=${res.productionOrder.id}`
            : undefined;
      const entry: ScanHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        scanValue: res.scanValue,
        timestamp: dayjs().toISOString(),
        domain: res.domain,
        label:
          res.domain === 'SHIPMENT'
            ? `Phiếu xuất ${res.shipment?.shipment_code ?? ''}`
            : res.domain === 'PRODUCTION_ORDER'
              ? `Lệnh SX ${res.productionOrder?.code ?? ''}`
              : 'Không tìm thấy',
        navigateTo: navPath,
      };
      setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
    },
    onError: (err: Error) => {
      messageApi.error(err.message || 'Không thể xử lý mã tra cứu.');
    },
  });

  // ── Camera lifecycle ───────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.destroy();
      scannerRef.current = null;
    }
    setCameraActive(false);
    setCameraError(null);
  }, []);

  const startCamera = useCallback(async () => {
    if (!videoRef.current) return;
    setCameraError(null);
    try {
      const hasCamera = await QrScanner.hasCamera();
      if (!hasCamera) {
        setCameraError('Không tìm thấy camera trên thiết bị này.');
        return;
      }
      const scanner = new QrScanner(
        videoRef.current,
        (qrResult) => {
          if (qrResult.data) {
            stopCamera();
            resolveMutation.mutate(qrResult.data);
          }
        },
        {
          preferredCamera: 'environment',
          highlightScanRegion: true,
          highlightCodeOutline: true,
        }
      );
      await scanner.start();
      scannerRef.current = scanner;
      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể khởi động camera.';
      if (msg.toLowerCase().includes('permission')) {
        setCameraError('Không có quyền truy cập camera. Vui lòng cấp quyền trong cài đặt trình duyệt.');
      } else {
        setCameraError(`Lỗi camera: ${msg}`);
      }
      setCameraActive(false);
    }
  }, [resolveMutation, stopCamera]);

  useEffect(() => {
    return () => {
      scannerRef.current?.destroy();
    };
  }, []);

  // ── Auto-resolve from URL ?q= param ───────────────────────────────────────

  useEffect(() => {
    const qParam = searchParams.get('q');
    if (qParam) {
      setScanInput(qParam);
      resolveMutation.mutate(qParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Focus input on desktop ─────────────────────────────────────────────────

  useEffect(() => {
    if (isDesktopMode && !cameraActive) {
      inputRef.current?.focus();
    }
  }, [isDesktopMode, cameraActive]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const trimmed = scanInput.trim();
    if (trimmed) {
      resolveMutation.mutate(trimmed);
    }
  }, [scanInput, resolveMutation]);

  const handleClear = useCallback(() => {
    setScanInput('');
    setResult(null);
    resolveMutation.reset();
    inputRef.current?.focus();
  }, [resolveMutation]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(
      () => messageApi.success('Đã sao chép.'),
      () => messageApi.error('Không thể sao chép.'),
    );
  }, [messageApi]);

  const handleNavigate = useCallback((path: string) => {
    const pathWithContext = appendScanCenterContext(path, '/scan-center');
    navigate(pathWithContext);
  }, [navigate]);

  // ── Result rendering ───────────────────────────────────────────────────────

  const renderShipmentResult = (shipment: ShipmentScanResolveResponse) => {
    const status = shipment.shipment_status ?? '';
    const statusLabel = SHIPMENT_STATUS_LABELS[status] ?? status ?? '—';
    const statusColor = SHIPMENT_STATUS_COLORS[status] ?? 'default';
    const packagesVerified = shipment.verified_package_count ?? 0;
    const packagesTotal = shipment.package_count ?? 0;
    const packagesLoaded = shipment.loaded_package_count ?? 0;

    return (
      <Card
        size="small"
        title={
          <Space>
            <QrcodeOutlined style={{ color: '#2563eb' }} />
            <span>Phiếu xuất</span>
            <Tag color={statusColor}>{statusLabel}</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            {shipment.order_id ? (
              <Button
                size="small"
                onClick={() => handleNavigate(`/sales-orders?focus_id=${shipment.order_id}`)}
              >
                Đơn hàng
              </Button>
            ) : null}
            {shipment.shipment_id ? (
              <Button
                type="primary"
                size="small"
                onClick={() => handleNavigate(`/shipments?focus_id=${shipment.shipment_id}`)}
              >
                Mở phiếu xuất
              </Button>
            ) : null}
          </Space>
        }
        style={{ borderLeft: '4px solid #2563eb' }}
      >
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
          <Descriptions.Item label="Mã phiếu xuất">
            <Space>
              <Text strong>{shipment.shipment_code || '—'}</Text>
              {shipment.shipment_code ? (
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => handleCopy(shipment.shipment_code!)}
                  title="Sao chép mã phiếu xuất"
                />
              ) : null}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Mã đơn hàng">
            <Space>
              {shipment.order_code || '—'}
              {shipment.order_code ? (
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => handleCopy(shipment.order_code!)}
                />
              ) : null}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Kiện hàng">
            <Space size={16}>
              <span>Tổng: <Text strong>{packagesTotal}</Text></span>
              <span>Xác nhận: <Text strong type={packagesVerified === packagesTotal ? 'success' : 'warning'}>{packagesVerified}/{packagesTotal}</Text></span>
              <span>Đã bốc: <Text strong>{packagesLoaded}</Text></span>
            </Space>
          </Descriptions.Item>
          {shipment.total_gross_weight_kg ? (
            <Descriptions.Item label="Khối lượng">
              {shipment.total_gross_weight_kg} kg
            </Descriptions.Item>
          ) : null}
          {shipment.carrier_name ? (
            <Descriptions.Item label="Đơn vị vận chuyển">
              {shipment.carrier_name}
            </Descriptions.Item>
          ) : null}
          {shipment.vehicle_no ? (
            <Descriptions.Item label="Số xe">
              {shipment.vehicle_no}
            </Descriptions.Item>
          ) : null}
          {shipment.driver_name ? (
            <Descriptions.Item label="Tài xế">
              <Space>
                {shipment.driver_name}
                {shipment.driver_phone ? (
                  <Text type="secondary">({shipment.driver_phone})</Text>
                ) : null}
              </Space>
            </Descriptions.Item>
          ) : null}
          {shipment.tracking_number ? (
            <Descriptions.Item label="Số tracking">
              <Space>
                {shipment.tracking_number}
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => handleCopy(shipment.tracking_number!)}
                />
              </Space>
            </Descriptions.Item>
          ) : null}
          {shipment.loading_confirmed_at ? (
            <Descriptions.Item label="Bàn giao xe">
              {dayjs(shipment.loading_confirmed_at).format('DD/MM/YYYY HH:mm')}
              {shipment.handover_receiver_name ? ` — ${shipment.handover_receiver_name}` : ''}
            </Descriptions.Item>
          ) : null}
          {shipment.delivery_confirmed_at ? (
            <Descriptions.Item label="Xác nhận giao xong">
              {dayjs(shipment.delivery_confirmed_at).format('DD/MM/YYYY HH:mm')}
              {shipment.customer_receiver_name ? ` — ${shipment.customer_receiver_name}` : ''}
            </Descriptions.Item>
          ) : null}
          {shipment.matched_by ? (
            <Descriptions.Item label="Khớp theo">
              <Tag color="geekblue">{shipment.matched_by === 'label_qr_value' ? 'Mã QR' : shipment.matched_by}</Tag>
            </Descriptions.Item>
          ) : null}
        </Descriptions>
      </Card>
    );
  };

  const renderProductionOrderResult = (order: ProductionOrder) => {
    const statusLabel = PRODUCTION_STATUS_LABELS[order.status] ?? order.status;
    const statusColor = PRODUCTION_STATUS_COLORS[order.status] ?? 'default';
    const productLabel = [order.product_code, order.product_name].filter(Boolean).join(' — ');

    return (
      <Card
        size="small"
        title={
          <Space>
            <QrcodeOutlined style={{ color: '#16a34a' }} />
            <span>Lệnh sản xuất</span>
            <Tag color={statusColor}>{statusLabel}</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <Button
              size="small"
              onClick={() => handleNavigate(`/production-planning?production_order_id=${order.id}`)}
            >
              Điều độ
            </Button>
            <Button
              type="primary"
              size="small"
              onClick={() => handleNavigate(`/production-orders?focus_id=${order.id}`)}
            >
              Mở lệnh SX
            </Button>
          </Space>
        }
        style={{ borderLeft: '4px solid #16a34a' }}
      >
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
          <Descriptions.Item label="Mã lệnh">
            <Text strong>{order.code}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Sản phẩm">
            {productLabel || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Ngày lệnh">
            {order.order_date ? dayjs(order.order_date).format('DD/MM/YYYY') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Hạn kế hoạch">
            {order.planned_end_date ? dayjs(order.planned_end_date).format('DD/MM/YYYY') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="SL kế hoạch">
            {order.planned_qty ? Number(order.planned_qty).toLocaleString('vi-VN') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Đã hoàn thành">
            {order.produced_qty ? Number(order.produced_qty).toLocaleString('vi-VN') : '0'}
          </Descriptions.Item>
          {order.sales_order_code ? (
            <Descriptions.Item label="Đơn hàng">
              {order.sales_order_code}
            </Descriptions.Item>
          ) : null}
          {order.qr_value ? (
            <Descriptions.Item label="Mã QR">
              <Space>
                <Text code style={{ fontSize: 12 }}>{order.qr_value}</Text>
                <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => handleCopy(order.qr_value!)} />
              </Space>
            </Descriptions.Item>
          ) : null}
        </Descriptions>
      </Card>
    );
  };

  const renderNotFound = () => (
    <Card size="small" style={{ borderLeft: '4px solid #94a3b8' }}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span>
            Không tìm thấy kết quả cho: <Text code>{result?.scanValue}</Text>
          </span>
        }
      >
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={handleClear}>
            Thử lại
          </Button>
          <Button
            onClick={() =>
              navigate(`/production-orders?search=${encodeURIComponent(result?.scanValue ?? '')}`)
            }
          >
            Tìm lệnh SX
          </Button>
          <Button
            onClick={() =>
              navigate(`/shipments?search=${encodeURIComponent(result?.scanValue ?? '')}`)
            }
          >
            Tìm phiếu xuất
          </Button>
        </Space>
      </Empty>
    </Card>
  );

  const renderResult = () => {
    if (resolveMutation.isPending) {
      return (
        <Card size="small">
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} />} />
            <div style={{ marginTop: 8, color: '#64748b', fontSize: 14 }}>Đang tra cứu...</div>
          </div>
        </Card>
      );
    }
    if (!result) return null;
    if (result.domain === 'SHIPMENT' && result.shipment) return renderShipmentResult(result.shipment);
    if (result.domain === 'PRODUCTION_ORDER' && result.productionOrder) return renderProductionOrderResult(result.productionOrder);
    if (result.domain === 'NOT_FOUND') return renderNotFound();
    return null;
  };

  // ── History rendering ──────────────────────────────────────────────────────

  const renderHistory = () => {
    if (history.length === 0) return null;
    return (
      <Card
        size="small"
        title={
          <Space>
            <HistoryOutlined />
            <span>Lịch sử quét phiên này ({history.length})</span>
          </Space>
        }
        extra={
          <Button
            type="text"
            size="small"
            onClick={() => setHistoryOpen((prev) => !prev)}
          >
            {historyOpen ? 'Thu gọn' : 'Mở rộng'}
          </Button>
        }
      >
        {historyOpen ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
            {history.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  cursor: entry.navigateTo ? 'pointer' : 'default',
                  transition: 'background 0.15s',
                }}
                role={entry.navigateTo ? 'button' : undefined}
                tabIndex={entry.navigateTo ? 0 : undefined}
                onClick={() => entry.navigateTo && handleNavigate(entry.navigateTo)}
                onKeyDown={(e) => e.key === 'Enter' && entry.navigateTo && handleNavigate(entry.navigateTo)}
              >
                <Space size={8}>
                  <Tag
                    color={
                      entry.domain === 'SHIPMENT' ? 'blue'
                        : entry.domain === 'PRODUCTION_ORDER' ? 'green'
                          : 'default'
                    }
                    style={{ fontSize: 11, margin: 0 }}
                  >
                    {entry.domain === 'SHIPMENT'
                      ? 'Phiếu xuất'
                      : entry.domain === 'PRODUCTION_ORDER'
                        ? 'Lệnh SX'
                        : 'Không tìm thấy'}
                  </Tag>
                  <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{entry.scanValue}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{entry.label}</Text>
                </Space>
                <Space size={8}>
                  <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(entry.timestamp).format('HH:mm:ss')}</Text>
                  {entry.navigateTo ? <RightOutlined style={{ fontSize: 10, color: '#94a3b8' }} /> : null}
                </Space>
              </div>
            ))}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {history[0].label} — {dayjs(history[0].timestamp).format('HH:mm:ss')}
          </Text>
        )}
      </Card>
    );
  };

  // ── Extra header actions ───────────────────────────────────────────────────

  const headerExtra = (
    <Space>
      {scanOrigin.active && scanOrigin.returnTo ? (
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(scanOrigin.returnTo!)}
        >
          Quay lại
        </Button>
      ) : null}
      {!isDesktopMode ? (
        <Button
          type={cameraActive ? 'default' : 'primary'}
          danger={cameraActive}
          icon={cameraActive ? <StopOutlined /> : <CameraOutlined />}
          onClick={cameraActive ? stopCamera : () => void startCamera()}
        >
          {cameraActive ? 'Dừng camera' : 'Bật camera'}
        </Button>
      ) : (
        <Segmented
          options={[
            { label: 'Nhập tay', value: 'manual' },
            { label: 'Camera', value: 'camera' },
          ]}
          value={cameraActive ? 'camera' : 'manual'}
          onChange={(v) => {
            if (v === 'camera') void startCamera();
            else stopCamera();
          }}
        />
      )}
    </Space>
  );

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div>
      {contextHolder}

      <PageHeader
        title="Trung tâm quét QR"
        subtitle={
          isDesktopMode
            ? 'Gõ hoặc quét bằng thiết bị QR cắm vào máy. Camera sẵn sàng theo yêu cầu.'
            : 'Dùng camera để quét, hoặc nhập mã thủ công. Hỗ trợ kiện hàng, lệnh sản xuất.'
        }
        extra={headerExtra}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Input area */}
        <Card size="small">
          <Row gutter={[8, 8]} align="middle">
            <Col flex="auto">
              <Input
                ref={inputRef}
                size="large"
                placeholder="Nhập mã QR, mã kiện, mã phiếu xuất, mã lệnh SX..."
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onPressEnter={handleSubmit}
                prefix={<QrcodeOutlined style={{ color: '#64748b' }} />}
                suffix={
                  scanInput ? (
                    <Button
                      type="text"
                      size="small"
                      icon={<ClearOutlined />}
                      onClick={handleClear}
                      style={{ color: '#94a3b8' }}
                      title="Xóa"
                    />
                  ) : null
                }
                autoComplete="off"
                data-testid="scan-center-input"
              />
            </Col>
            <Col>
              <Button
                type="primary"
                size="large"
                loading={resolveMutation.isPending}
                onClick={handleSubmit}
                disabled={!scanInput.trim()}
                data-testid="scan-center-submit"
              >
                Tra cứu
              </Button>
            </Col>
          </Row>
        </Card>

        {/* Camera view */}
        {(cameraActive || cameraError) ? (
          <Card
            size="small"
            title={
              <Space>
                <CameraOutlined />
                <span>Camera quét QR</span>
              </Space>
            }
            extra={
              <Button size="small" danger icon={<StopOutlined />} onClick={stopCamera}>
                Dừng camera
              </Button>
            }
          >
            {cameraError ? (
              <Alert
                type="error"
                message={cameraError}
                showIcon
                action={
                  <Button size="small" onClick={() => { setCameraError(null); void startCamera(); }}>
                    Thử lại
                  </Button>
                }
              />
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <video
                  ref={videoRef}
                  data-testid="scan-center-camera-video"
                  style={{
                    width: '100%',
                    maxWidth: 480,
                    borderRadius: 8,
                    background: '#000',
                    display: 'block',
                  }}
                  playsInline
                  muted
                />
              </div>
            )}
          </Card>
        ) : null}

        {/* Result */}
        {(resolveMutation.isPending || result) ? renderResult() : null}

        {/* History */}
        {renderHistory()}

      </div>
    </div>
  );
}
