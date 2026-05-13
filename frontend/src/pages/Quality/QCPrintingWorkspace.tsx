import { useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Input, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined, FileImageOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { qualityApi } from '../../api/quality';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import type {
  QualityDefect,
  QualityImageArtifact,
  QualityInspection,
  QualityInspectionLine,
  QualityInspectionResult,
  QualityInspectionStatus,
  VisionInspectionJob,
} from '../../types/quality';

const { Text, Title } = Typography;

type FilterValues = {
  status: QualityInspectionStatus | 'ALL';
  result: QualityInspectionResult | 'ALL';
};

const DEFAULT_FILTERS: FilterValues = {
  status: 'ALL',
  result: 'ALL',
};

const STATUS_LABELS: Record<QualityInspectionStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Đã gửi',
  REVIEWED: 'Đã review',
  CANCELLED: 'Đã hủy',
};

const STATUS_COLORS: Record<QualityInspectionStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  REVIEWED: 'success',
  CANCELLED: 'default',
};

const RESULT_LABELS: Record<QualityInspectionResult, string> = {
  PENDING: 'Chờ kết quả',
  PASS: 'PASS',
  CONDITIONAL_PASS: 'PASS có điều kiện',
  FAIL: 'FAIL',
  HOLD: 'HOLD',
  REWORK: 'REWORK',
  NEED_REVIEW: 'Cần review',
  CANCELLED: 'Đã hủy',
};

const RESULT_COLORS: Record<QualityInspectionResult, string> = {
  PENDING: 'default',
  PASS: 'success',
  CONDITIONAL_PASS: 'cyan',
  FAIL: 'error',
  HOLD: 'warning',
  REWORK: 'orange',
  NEED_REVIEW: 'processing',
  CANCELLED: 'default',
};

function serializeFilters(filters: FilterValues): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): FilterValues {
  try {
    const parsed = JSON.parse(raw) as Partial<FilterValues>;
    return {
      status: parsed.status ?? DEFAULT_FILTERS.status,
      result: parsed.result ?? DEFAULT_FILTERS.result,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function textFromSnapshot(snapshot: Record<string, unknown> | undefined, key: string): string {
  const value = snapshot?.[key];
  if (value === null || value === undefined) return '';
  return String(value);
}

function productLabel(record: QualityInspection): string {
  const code = textFromSnapshot(record.expected_print_snapshot, 'product_code') || textFromSnapshot(record.expected_print_snapshot, 'code');
  const name = textFromSnapshot(record.expected_print_snapshot, 'product_name') || textFromSnapshot(record.expected_print_snapshot, 'name');
  if (code && name) return `${code} - ${name}`;
  return code || name || (record.product ? `#${record.product}` : '-');
}

function productionOrderLabel(record: QualityInspection): string {
  return textFromSnapshot(record.production_context_snapshot, 'production_order_code') || (record.production_order ? `#${record.production_order}` : '-');
}

function inspectorLabel(record: QualityInspection): string {
  return record.inspector ? `#${record.inspector}` : '-';
}

function matchesKeyword(record: QualityInspection, keyword: string): boolean {
  if (!keyword) return true;
  const haystack = [
    record.code,
    record.operation_code,
    record.operation_name,
    record.machine_code,
    record.machine_name,
    record.work_center_code,
    productLabel(record),
    productionOrderLabel(record),
  ].join(' ').toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

function statusTag(statusValue: QualityInspectionStatus) {
  return <Tag color={STATUS_COLORS[statusValue]}>{STATUS_LABELS[statusValue] ?? statusValue}</Tag>;
}

function resultTag(resultValue: QualityInspectionResult) {
  return <Tag color={RESULT_COLORS[resultValue]}>{RESULT_LABELS[resultValue] ?? resultValue}</Tag>;
}

export default function QCPrintingWorkspace() {
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTERS);
  const [selectedInspectionId, setSelectedInspectionId] = useState<number | null>(null);

  const {
    intentSearch,
    intentFilters,
    intentFilterStableString,
  } = useSearchFilterIntent<FilterValues>({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 500,
    filterDebounceMs: 250,
    serializeFilters,
    parseFilters,
  });

  const queryParams = useMemo(() => ({
    page_size: 50,
    ...(intentFilters.status !== 'ALL' ? { status: intentFilters.status } : {}),
    ...(intentFilters.result !== 'ALL' ? { result: intentFilters.result } : {}),
  }), [intentFilters.result, intentFilters.status]);

  const inspectionsQuery = useQuery({
    queryKey: ['quality-printing-inspections', queryParams, intentFilterStableString],
    queryFn: () => qualityApi.listPrintingInspections(queryParams),
  });

  const storageSettingsQuery = useQuery({
    queryKey: ['quality-storage-settings-shell'],
    queryFn: () => qualityApi.getStorageSettings(),
    staleTime: 60_000,
  });

  const detailQuery = useQuery({
    queryKey: ['quality-printing-inspection-detail', selectedInspectionId],
    queryFn: () => qualityApi.getPrintingInspection(selectedInspectionId as number),
    enabled: selectedInspectionId !== null,
  });

  const rows = useMemo(
    () => (inspectionsQuery.data?.results ?? []).filter((record) => matchesKeyword(record, intentSearch.trim())),
    [inspectionsQuery.data?.results, intentSearch],
  );

  const selectedInspection = detailQuery.data;
  const counts = useMemo(() => {
    const allRows = inspectionsQuery.data?.results ?? [];
    return {
      total: inspectionsQuery.data?.count ?? allRows.length,
      pass: allRows.filter((item) => item.result === 'PASS' || item.result === 'CONDITIONAL_PASS').length,
      attention: allRows.filter((item) => ['FAIL', 'HOLD', 'REWORK', 'NEED_REVIEW'].includes(item.result)).length,
    };
  }, [inspectionsQuery.data]);

  const columns: ColumnsType<QualityInspection> = [
    {
      title: 'Mã phiếu',
      dataIndex: 'code',
      width: 150,
      fixed: 'left',
      render: (value: string, record) => (
        <Button type="link" size="small" onClick={() => setSelectedInspectionId(record.id)} style={{ paddingInline: 0 }}>
          {value}
        </Button>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 125,
      render: statusTag,
    },
    {
      title: 'Kết quả',
      dataIndex: 'result',
      width: 145,
      render: resultTag,
    },
    {
      title: 'Mã hàng / sản phẩm',
      key: 'product',
      width: 240,
      render: (_, record) => productLabel(record),
    },
    {
      title: 'LSX',
      key: 'production_order',
      width: 140,
      render: (_, record) => productionOrderLabel(record),
    },
    {
      title: 'Công đoạn',
      key: 'operation',
      width: 140,
      render: (_, record) => [record.operation_code, record.operation_name].filter(Boolean).join(' - ') || '-',
    },
    {
      title: 'Máy',
      key: 'machine',
      width: 150,
      render: (_, record) => [record.machine_code, record.machine_name].filter(Boolean).join(' - ') || '-',
    },
    {
      title: 'Người kiểm',
      key: 'inspector',
      width: 110,
      render: (_, record) => inspectorLabel(record),
    },
    {
      title: 'Ngày tạo',
      dataIndex: 'created_at',
      width: 150,
      render: (value: string) => dayjs(value).format('DD/MM/YYYY HH:mm'),
    },
    {
      title: '',
      key: 'action',
      fixed: 'right',
      width: 72,
      render: (_, record) => (
        <Button icon={<EyeOutlined />} size="small" onClick={() => setSelectedInspectionId(record.id)} />
      ),
    },
  ];

  const lineColumns: ColumnsType<QualityInspectionLine> = [
    { title: 'Hạng mục', dataIndex: 'label' },
    { title: 'Kỳ vọng', dataIndex: 'expected_value', width: 160, render: (value: string) => value || '-' },
    { title: 'Thực tế', dataIndex: 'actual_value', width: 160, render: (value: string) => value || '-' },
    { title: 'Kết quả', dataIndex: 'result', width: 90, render: (value: string) => <Tag>{value}</Tag> },
  ];

  const defectColumns: ColumnsType<QualityDefect> = [
    { title: 'Mã lỗi', dataIndex: 'defect_code', width: 120 },
    { title: 'Tên lỗi', dataIndex: 'defect_name' },
    { title: 'Mức độ', dataIndex: 'severity', width: 100, render: (value: string) => <Tag color={value === 'CRITICAL' ? 'error' : value === 'MAJOR' ? 'warning' : 'default'}>{value}</Tag> },
    { title: 'SL', dataIndex: 'quantity', width: 70 },
  ];

  const artifactColumns: ColumnsType<QualityImageArtifact> = [
    { title: 'Loại ảnh', dataIndex: 'image_type', width: 150 },
    { title: 'Kết quả', dataIndex: 'result_status', width: 140, render: resultTag },
    { title: 'Path', dataIndex: 'storage_path', ellipsis: true },
    { title: 'Pin', dataIndex: 'is_pinned', width: 70, render: (value: boolean) => (value ? <Tag color="blue">Pin</Tag> : '-') },
  ];

  const jobColumns: ColumnsType<VisionInspectionJob> = [
    { title: 'Job ID', dataIndex: 'job_id', ellipsis: true },
    { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (value: string) => <Tag color={value === 'QUEUED' ? 'processing' : 'default'}>{value}</Tag> },
    { title: 'Queue', dataIndex: 'queue_name', width: 160 },
    { title: 'Tạo lúc', dataIndex: 'created_at', width: 150, render: (value: string) => dayjs(value).format('DD/MM/YYYY HH:mm') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 280, maxWidth: 780 }}>
          <Space size={8} align="center" style={{ marginBottom: 8 }}>
            <SafetyCertificateOutlined style={{ color: '#1677ff', fontSize: 22 }} />
            <Title level={2} style={{ margin: 0 }}>QC Printing - Kiểm tra chất lượng in</Title>
          </Space>
          <Text type="secondary">
            Quản lý phiếu kiểm, kết quả, lỗi, ảnh bằng chứng và job xử lý ảnh cho công đoạn in thùng carton.
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={inspectionsQuery.isFetching} onClick={() => void inspectionsQuery.refetch()}>
          Tải lại
        </Button>
      </div>

      <Alert
        showIcon
        type="info"
        message="Vision viewer, ROI editor, diff/heatmap sẽ triển khai ở giai đoạn sau"
        description="Giai đoạn này chỉ hiển thị shell quản lý và metadata. Ảnh lớn, so sánh ảnh và xử lý nền chưa được kích hoạt trong UI."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ border: '1px solid #edf2f7', borderRadius: 8, padding: 14 }}>
          <Statistic title="Phiếu trong bộ lọc" value={counts.total} />
        </div>
        <div style={{ border: '1px solid #edf2f7', borderRadius: 8, padding: 14 }}>
          <Statistic title="PASS / có điều kiện" value={counts.pass} valueStyle={{ color: '#389e0d' }} />
        </div>
        <div style={{ border: '1px solid #edf2f7', borderRadius: 8, padding: 14 }}>
          <Statistic title="Cần xử lý" value={counts.attention} valueStyle={{ color: counts.attention > 0 ? '#cf1322' : '#64748b' }} />
        </div>
        <div style={{ border: '1px solid #edf2f7', borderRadius: 8, padding: 14 }}>
          <Statistic
            title="Cleanup ảnh"
            value={storageSettingsQuery.data?.cleanup_paused ? 'Tạm dừng' : 'Dry-run'}
            prefix={<FileImageOutlined />}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Tìm mã phiếu, mã hàng, LSX, công đoạn, máy..."
          style={{ width: 360, maxWidth: '100%' }}
          suffix={searchInput ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" /> : undefined}
        />
        <Select
          value={filters.status}
          onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
          style={{ width: 170 }}
          options={[
            { value: 'ALL', label: 'Tất cả trạng thái' },
            ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Select
          value={filters.result}
          onChange={(value) => setFilters((current) => ({ ...current, result: value }))}
          style={{ width: 190 }}
          options={[
            { value: 'ALL', label: 'Tất cả kết quả' },
            ...Object.entries(RESULT_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
      </div>

      {inspectionsQuery.isError ? (
        <Alert
          showIcon
          type="error"
          message="Không thể tải danh sách phiếu QC Printing."
          action={<Button size="small" onClick={() => void inspectionsQuery.refetch()}>Thử lại</Button>}
        />
      ) : null}

      <Table<QualityInspection>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={inspectionsQuery.isLoading || inspectionsQuery.isFetching}
        scroll={{ x: 1420 }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        locale={{ emptyText: <Empty description={intentSearch || filters.status !== 'ALL' || filters.result !== 'ALL' ? 'Không tìm thấy phiếu QC phù hợp.' : 'Chưa có phiếu QC Printing nào.'} /> }}
        onRow={(record) => ({
          onDoubleClick: () => setSelectedInspectionId(record.id),
        })}
      />

      <Drawer
        title={selectedInspection ? `Phiếu ${selectedInspection.code}` : 'Chi tiết QC Printing'}
        open={selectedInspectionId !== null}
        width={920}
        onClose={() => setSelectedInspectionId(null)}
      >
        {detailQuery.isLoading ? (
          <div style={{ padding: 24 }}>Đang tải chi tiết...</div>
        ) : selectedInspection ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Trạng thái">{statusTag(selectedInspection.status)}</Descriptions.Item>
              <Descriptions.Item label="Kết quả">{resultTag(selectedInspection.result)}</Descriptions.Item>
              <Descriptions.Item label="Mã hàng">{productLabel(selectedInspection)}</Descriptions.Item>
              <Descriptions.Item label="LSX">{productionOrderLabel(selectedInspection)}</Descriptions.Item>
              <Descriptions.Item label="Công đoạn">{[selectedInspection.operation_code, selectedInspection.operation_name].filter(Boolean).join(' - ') || '-'}</Descriptions.Item>
              <Descriptions.Item label="Máy">{[selectedInspection.machine_code, selectedInspection.machine_name].filter(Boolean).join(' - ') || '-'}</Descriptions.Item>
              <Descriptions.Item label="Người kiểm">{inspectorLabel(selectedInspection)}</Descriptions.Item>
              <Descriptions.Item label="Ngày tạo">{dayjs(selectedInspection.created_at).format('DD/MM/YYYY HH:mm')}</Descriptions.Item>
            </Descriptions>

            <Alert
              showIcon
              type="success"
              message="Vision result chỉ là đề xuất; kết quả QC chính thức do người dùng hoặc reviewer chốt."
            />

            <section>
              <Title level={4}>Checklist</Title>
              <Table<QualityInspectionLine>
                rowKey="id"
                columns={lineColumns}
                dataSource={selectedInspection.lines ?? []}
                pagination={false}
                locale={{ emptyText: <Empty description="Chưa có checklist cho phiếu này." /> }}
              />
            </section>

            <section>
              <Title level={4}>Lỗi ghi nhận</Title>
              <Table<QualityDefect>
                rowKey="id"
                columns={defectColumns}
                dataSource={selectedInspection.defects ?? []}
                pagination={false}
                locale={{ emptyText: <Empty description="Chưa có lỗi nào được ghi nhận." /> }}
              />
            </section>

            <section>
              <Title level={4}>Ảnh bằng chứng</Title>
              <Table<QualityImageArtifact>
                rowKey="id"
                columns={artifactColumns}
                dataSource={selectedInspection.image_artifacts ?? []}
                pagination={false}
                locale={{ emptyText: <Empty description="Chưa có metadata ảnh bằng chứng." /> }}
              />
            </section>

            <section>
              <Title level={4}>Vision jobs</Title>
              <Table<VisionInspectionJob>
                rowKey="id"
                columns={jobColumns}
                dataSource={selectedInspection.vision_jobs ?? []}
                pagination={false}
                locale={{ emptyText: <Empty description="Chưa có job xử lý ảnh." /> }}
              />
            </section>
          </div>
        ) : (
          <Empty description="Chưa có dữ liệu chi tiết phiếu QC." />
        )}
      </Drawer>
    </div>
  );
}
