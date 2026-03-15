import React, { useState } from 'react';
import {
  Table, Button, Space, Input, Modal, Skeleton, Empty, message, Tag, Row, Col, Card, Statistic, Form, InputNumber, Select,
} from 'antd';
import { PlusOutlined, EyeOutlined, DownloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { productionOrdersApi } from '../../api/productionOrders';
import { ProductionIssue } from '../../types/productionOrders';
import { getToastMessage } from '../../utils/authz';
import { downloadCSV } from '../../utils/csvExport';

const MaterialIssueList: React.FC = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formOpen, setFormOpen] = useState(false);
  const [form] = Form.useForm();
  const [detailModal, setDetailModal] = useState<ProductionIssue | null>(null);
  const queryClient = useQueryClient();

  const params = {
    search: search || undefined,
    page,
    page_size: pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['material-issues', params],
    queryFn: () => productionOrdersApi.getIssues(params),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => productionOrdersApi.issueMateri als(0, data),
    onSuccess: () => {
      message.success('Phát hành nguyên vật liệu thành công');
      form.resetFields();
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ['material-issues'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Phát hành nguyên vật liệu thất bại'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => productionOrdersApi.deleteOrder(id),
    onSuccess: () => {
      message.success('Xóa phát hành thành công');
      queryClient.invalidateQueries({ queryKey: ['material-issues'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Xóa phát hành thất bại'));
    },
  });

  const issueTypeLabel: Record<string, string> = {
    MATERIAL: 'Nguyên vật liệu',
    COMPONENT: 'Linh kiện',
    RETURN: 'Trả lại',
  };

  const handleExportCSV = () => {
    if (data?.results) {
      const csvData = data.results.map((issue: ProductionIssue) => ({
        'Mã LSX': issue.production_order_code,
        'Sản phẩm': issue.product_name,
        'Loại': issueTypeLabel[issue.issue_type] || issue.issue_type,
        'SL phát hành': issue.quantity_issued,
        'Ngày': dayjs(issue.issued_at).format('DD/MM/YYYY HH:mm'),
        'Người phát hành': issue.issued_by_name,
      }));
      downloadCSV(csvData, 'phat-hanh-nvl');
    }
  };

  const totalIssued = data?.results?.reduce((sum: number, issue: ProductionIssue) => sum + issue.quantity_issued, 0) || 0;

  const columns = [
    {
      title: 'Mã LSX',
      dataIndex: 'production_order_code',
      key: 'production_order_code',
      width: 100,
    },
    {
      title: 'Sản phẩm',
      dataIndex: 'product_name',
      key: 'product_name',
      width: 150,
    },
    {
      title: 'Loại',
      dataIndex: 'issue_type',
      key: 'issue_type',
      width: 120,
      render: (type: string) => {
        const color = type === 'MATERIAL' ? 'blue' : type === 'COMPONENT' ? 'orange' : 'red';
        return <Tag color={color}>{issueTypeLabel[type] || type}</Tag>;
      },
    },
    {
      title: 'SL phát hành',
      dataIndex: 'quantity_issued',
      key: 'quantity_issued',
      width: 100,
      align: 'right' as const,
    },
    {
      title: 'Ngày',
      dataIndex: 'issued_at',
      key: 'issued_at',
      width: 150,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY HH:mm'),
    },
    {
      title: 'Người phát hành',
      dataIndex: 'issued_by_name',
      key: 'issued_by_name',
      width: 120,
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 150,
      render: (_, row: ProductionIssue) => (
        <Space wrap size="small">
          <Button 
            size="small" 
            icon={<EyeOutlined />} 
            onClick={() => setDetailModal(row)}
          >
            Xem
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: 'Xóa phát hành',
                content: 'Xóa phát hành nguyên vật liệu?',
                okText: 'Xóa',
                cancelText: 'Không',
                okButtonProps: { danger: true },
                onOk: () => deleteMutation.mutate(row.id!),
              });
            }}
          >
            Xóa
          </Button>
        </Space>
      ),
    },
  ];

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      createMutation.mutate({
        ...values,
        issued_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      });
    } catch (error) {
      message.error('Vui lòng kiểm tra lại form');
    }
  };

  if (isLoading && !data) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Thống kê */}
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={8}>
            <Statistic
              title="Tổng phát hành"
              value={data?.count || 0}
              valueStyle={{ color: '#1677ff' }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="Tổng SL phát hành"
              value={totalIssued}
              valueStyle={{ color: '#52c41a' }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="Ngày hôm nay"
              value={data?.results?.filter((i: ProductionIssue) => 
                dayjs(i.issued_at).isSame(dayjs(), 'day')
              ).length || 0}
              valueStyle={{ color: '#faad14' }}
            />
          </Col>
        </Row>
      </Card>

      {/* Bộ lọc */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Input
          placeholder="Tìm mã lệnh, sản phẩm..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ width: '200px' }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormOpen(true)}>
          Phát hành
        </Button>
        <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
          Xuất CSV
        </Button>
      </div>

      {/* Bảng danh sách */}
      <Table
        columns={columns}
        dataSource={data?.results || []}
        loading={isLoading}
        pagination={{
          current: page,
          pageSize,
          total: data?.count,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
        }}
        rowKey="id"
        scroll={{ x: 1200 }}
        locale={{
          emptyText: <Empty description="Chưa có phát hành nào" />,
        }}
      />

      {/* Modal phát hành */}
      <Modal
        title="Phát hành nguyên vật liệu"
        open={formOpen}
        onCancel={() => { setFormOpen(false); form.resetFields(); }}
        onOk={handleSubmit}
        loading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item 
            label="Lệnh sản xuất" 
            name="production_order_id" 
            rules={[{ required: true, message: 'Chọn lệnh sản xuất' }]}
          >
            <Select placeholder="Chọn lệnh sản xuất" />
          </Form.Item>
          <Form.Item 
            label="Loại" 
            name="issue_type" 
            rules={[{ required: true, message: 'Chọn loại phát hành' }]}
          >
            <Select 
              placeholder="Chọn loại phát hành"
              options={[
                { label: 'Nguyên vật liệu', value: 'MATERIAL' },
                { label: 'Linh kiện', value: 'COMPONENT' },
                { label: 'Trả lại', value: 'RETURN' },
              ]}
            />
          </Form.Item>
          <Form.Item 
            label="Số lượng" 
            name="quantity_issued" 
            rules={[{ required: true, message: 'Nhập số lượng' }]}
          >
            <InputNumber min={0} placeholder="Số lượng" />
          </Form.Item>
          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={2} placeholder="Ghi chú" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal chi tiết */}
      <Modal
        title="Chi tiết phát hành"
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={null}
        width={600}
      >
        {detailModal && (
          <div>
            <p><strong>Lệnh sản xuất:</strong> {detailModal.production_order_code}</p>
            <p><strong>Sản phẩm:</strong> {detailModal.product_name}</p>
            <p><strong>Loại:</strong> <Tag color="blue">{issueTypeLabel[detailModal.issue_type]}</Tag></p>
            <p><strong>Số lượng:</strong> {detailModal.quantity_issued}</p>
            <p><strong>Ngày:</strong> {dayjs(detailModal.issued_at).format('DD/MM/YYYY HH:mm')}</p>
            <p><strong>Người phát hành:</strong> {detailModal.issued_by_name}</p>
            {detailModal.note && (
              <p><strong>Ghi chú:</strong> {detailModal.note}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default MaterialIssueList;
