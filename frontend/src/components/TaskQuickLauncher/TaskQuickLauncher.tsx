import { useMemo, useState } from 'react';
import { Button, Empty, Input, List, Modal, Space, Spin, Tag, Tooltip } from 'antd';
import { PlusOutlined, ProjectOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../../api/products';
import type { Product } from '../../types/product';
import TaskWorkspaceModal from '../TaskWorkspaceModal/TaskWorkspaceModal';
import QuickClearIcon from '../QuickClearIcon/QuickClearIcon';

export default function TaskQuickLauncher() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);

  const query = useQuery({
    queryKey: ['quick-task-products', search],
    queryFn: () => productsApi.getProducts({ page: 1, page_size: 12, search }),
    enabled: open,
    staleTime: 15_000,
  });

  const products = useMemo(() => query.data?.results ?? [], [query.data]);

  return (
    <>
      <Tooltip title="Giao nhiệm vụ nhanh theo mã hàng (không cần vào trang sản phẩm)">
        <Button
          type="default"
          icon={<ProjectOutlined />}
          onClick={() => setOpen(true)}
          style={{ borderColor: '#91caff', color: '#0958d9' }}
        >
          Giao nhiệm vụ nhanh
        </Button>
      </Tooltip>

      <Modal
        title={<Space><ProjectOutlined style={{ color: '#1677ff' }} />Giao nhiệm vụ nhanh theo mã hàng</Space>}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={680}
        destroyOnClose
      >
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo mã hàng / tên hàng..."
          style={{ marginBottom: 10 }}
          suffix={
            search
              ? <QuickClearIcon onClear={() => setSearch('')} title="Xóa tìm kiếm" />
              : undefined
          }
        />
        {query.isLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : products.length === 0 ? (
          <Empty description="Không tìm thấy mã hàng" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            size="small"
            dataSource={products}
            renderItem={(p) => (
              <List.Item
                actions={[
                  <Button key={`task-${p.id}`} type="link" icon={<PlusOutlined />} onClick={() => setSelected(p)}>
                    Giao nhiệm vụ
                  </Button>,
                ]}
              >
                <Space direction="vertical" size={2}>
                  <Space>
                    <Tag color="blue" style={{ marginInlineEnd: 0 }}>{p.code}</Tag>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                  </Space>
                  <span style={{ color: '#8c8c8c', fontSize: 12 }}>{p.category_name || '-'} · {p.unit_name || '-'}</span>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Modal>

      <TaskWorkspaceModal
        open={!!selected}
        onClose={() => setSelected(null)}
        entityType="Product"
        entityId={selected?.id ?? null}
        entityCode={selected?.code}
        blockingCount={selected?.blocking_tasks_count ?? 0}
        titlePrefix="Giao nhiệm vụ"
      />
    </>
  );
}
