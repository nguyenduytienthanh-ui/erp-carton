import { useMemo, useState } from 'react';
import { Button, Card, Drawer, Empty, Input, List, message, Select, Space, Spin, Tag, Typography } from 'antd';
import { ReloadOutlined, ProjectOutlined, SwapRightOutlined, WarningOutlined, HistoryOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  workflowTaskTemplatesApi,
  WFT_TRIGGER_LABELS,
  type WftTrigger,
  type WorkflowPipelineCard,
  type WorkflowPipelineTimelineItem,
} from '../../api/workflowTaskTemplates';
import { QuickClearIcon, TaskWorkspaceModal } from '../../components';

const { Text } = Typography;

export default function WorkflowPipelineBoard() {
  const [entityType, setEntityType] = useState<'SalesOrder' | 'Product' | 'Customer'>('SalesOrder');
  const [trigger, setTrigger] = useState<WftTrigger>('SUBMIT');
  const [search, setSearch] = useState('');
  const [slaFilter, setSlaFilter] = useState<'ALL' | 'OVERDUE' | 'DUE_TODAY'>('ALL');
  const [selectedCard, setSelectedCard] = useState<WorkflowPipelineCard | null>(null);
  const [draggingCard, setDraggingCard] = useState<WorkflowPipelineCard | null>(null);
  const [timelineCard, setTimelineCard] = useState<WorkflowPipelineCard | null>(null);
  const queryClient = useQueryClient();

  const templatesQuery = useQuery({
    queryKey: ['workflow-active-templates'],
    queryFn: () => workflowTaskTemplatesApi.list({ is_active: true }),
    staleTime: 30_000,
  });

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const availableEntityTypes = useMemo(() => {
    const set = new Set<string>();
    templates.forEach((t) => set.add(t.entity_type));
    return Array.from(set);
  }, [templates]);

  const effectiveEntityType = useMemo(() => {
    if (!templates.length) return entityType;
    const hasCurrent = templates.some((t) => t.entity_type === entityType);
    if (hasCurrent) return entityType;
    return templates[0].entity_type as 'SalesOrder' | 'Product' | 'Customer';
  }, [templates, entityType]);

  const triggerOptionsForEntity = useMemo(() => {
    const set = new Set<WftTrigger>();
    templates
      .filter((t) => t.entity_type === effectiveEntityType)
      .forEach((t) => set.add(t.trigger));
    const values = Array.from(set);
    return values.map((value) => ({ value, label: WFT_TRIGGER_LABELS[value] ?? value }));
  }, [templates, effectiveEntityType]);

  const effectiveTrigger = useMemo(() => {
    if (!triggerOptionsForEntity.length) return trigger;
    const hasCurrent = triggerOptionsForEntity.some((opt) => opt.value === trigger);
    if (hasCurrent) return trigger;
    return triggerOptionsForEntity[0].value;
  }, [triggerOptionsForEntity, trigger]);

  const isFallbackCombo = effectiveEntityType !== entityType || effectiveTrigger !== trigger;

  const boardQuery = useQuery({
    queryKey: ['workflow-pipeline-board', effectiveEntityType, effectiveTrigger],
    queryFn: () => workflowTaskTemplatesApi.getPipelineBoard({ entity_type: effectiveEntityType, trigger: effectiveTrigger, limit: 300 }),
    staleTime: 10_000,
  });

  const timelineQuery = useQuery({
    queryKey: ['workflow-pipeline-timeline', effectiveEntityType, timelineCard?.entity_id],
    queryFn: () =>
      workflowTaskTemplatesApi.getPipelineTimeline({
        entity_type: effectiveEntityType,
        entity_id: timelineCard!.entity_id,
        limit: 100,
      }),
    enabled: !!timelineCard?.entity_id,
    staleTime: 5_000,
  });

  const refreshBoard = () => {
    void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-board'] });
  };

  const advanceMutation = useMutation({
    mutationFn: (card: WorkflowPipelineCard) =>
      workflowTaskTemplatesApi.advancePipeline({
        entity_type: effectiveEntityType,
        entity_id: card.entity_id,
        entity_code: card.entity_code,
        trigger: effectiveTrigger,
      }),
    onSuccess: (res) => {
      message.success(res.message || 'Đã chuyển bước.');
      refreshBoard();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Không thể chuyển bước.');
    },
  });

  const moveMutation = useMutation({
    mutationFn: ({ card, targetColumnId }: { card: WorkflowPipelineCard; targetColumnId: string }) =>
      workflowTaskTemplatesApi.movePipelineCard({
        entity_type: effectiveEntityType,
        entity_id: card.entity_id,
        entity_code: card.entity_code,
        trigger: effectiveTrigger,
        target_column_id: targetColumnId,
      }),
    onSuccess: (res) => {
      message.success(res.message || 'Đã di chuyển card.');
      refreshBoard();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Không thể di chuyển card.');
    },
  });

  const retryFailedMutation = useMutation({
    mutationFn: (card: WorkflowPipelineCard) =>
      workflowTaskTemplatesApi.retryPipelineFailed({
        entity_type: effectiveEntityType,
        entity_id: card.entity_id,
        entity_code: card.entity_code,
        trigger: effectiveTrigger,
      }),
    onSuccess: (res) => {
      message.success(res.message || 'Đã khôi phục card failed.');
      refreshBoard();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Không thể khôi phục card failed.');
    },
  });

  const columns = useMemo(() => {
    const data = boardQuery.data?.columns ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.map((col) => ({
      ...col,
      cards: col.cards.filter((card) =>
        `${card.entity_code} ${card.current_step} ${card.owner} ${card.team}`.toLowerCase().includes(q)
      ),
    }));
  }, [boardQuery.data?.columns, search]);

  const filteredColumns = useMemo(() => {
    if (slaFilter === 'ALL') return columns;
    return columns.map((col) => ({
      ...col,
      cards: col.cards.filter((card) => card.sla_state === slaFilter),
    }));
  }, [columns, slaFilter]);

  const totalCards = useMemo(
    () => filteredColumns.reduce((acc, col) => acc + col.cards.length, 0),
    [filteredColumns]
  );

  const renderSlaTag = (card: WorkflowPipelineCard) => {
    if (card.sla_state === 'OVERDUE') return <Tag color="error">Quá hạn</Tag>;
    if (card.sla_state === 'DUE_TODAY') return <Tag color="gold">Đến hạn hôm nay</Tag>;
    return <Tag color="green">Đúng hạn</Tag>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Space wrap>
            <Text strong style={{ fontSize: 16 }}>Workflow Pipeline</Text>
            <Tag color="blue">{effectiveEntityType}</Tag>
            <Tag>{totalCards} thẻ</Tag>
          </Space>
          <Space wrap>
            <Input
              placeholder="Tìm mã đơn, bước, người phụ trách..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280 }}
              suffix={search ? <QuickClearIcon onClear={() => setSearch('')} title="Xóa tìm kiếm" /> : undefined}
            />
            <Select<WftTrigger>
              value={effectiveTrigger}
              onChange={setTrigger}
              style={{ width: 200 }}
              options={triggerOptionsForEntity}
            />
            <Select<'SalesOrder' | 'Product' | 'Customer'>
              value={entityType}
              onChange={(v) => {
                setEntityType(v);
                setSelectedCard(null);
                setTimelineCard(null);
              }}
              style={{ width: 170 }}
              options={
                (availableEntityTypes.length
                  ? availableEntityTypes
                  : ['SalesOrder', 'Product', 'Customer']
                ).map((v) => ({ value: v, label: v }))
              }
            />
            <Select<'ALL' | 'OVERDUE' | 'DUE_TODAY'>
              value={slaFilter}
              onChange={setSlaFilter}
              style={{ width: 170 }}
              options={[
                { value: 'ALL', label: 'Tất cả SLA' },
                { value: 'OVERDUE', label: 'Chỉ quá hạn' },
                { value: 'DUE_TODAY', label: 'Đến hạn hôm nay' },
              ]}
            />
            <Button icon={<ReloadOutlined />} loading={boardQuery.isFetching} onClick={() => boardQuery.refetch()}>
              Tải lại
            </Button>
          </Space>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Tag color="processing">Combo dữ liệu: {effectiveEntityType} / {WFT_TRIGGER_LABELS[effectiveTrigger] ?? effectiveTrigger}</Tag>
          {isFallbackCombo && (
            <Tag color="gold">
              Đã tự chuyển từ {entityType} / {WFT_TRIGGER_LABELS[trigger] ?? trigger} sang combo có template active
            </Tag>
          )}
        </div>
        {!!boardQuery.data?.meta?.message && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Tag color={boardQuery.data.meta.diagnostic_code === 'NO_TEMPLATE' ? 'red' : 'gold'} style={{ width: 'fit-content' }}>
              {boardQuery.data.meta.message}
            </Tag>
            {(boardQuery.data.meta.hints ?? []).length > 0 && (
              <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                {(boardQuery.data.meta.hints ?? []).map((hint) => (
                  <div key={hint}>- {hint}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {boardQuery.isLoading ? (
        <Card size="small"><div style={{ textAlign: 'center', padding: 40 }}><Spin /></div></Card>
      ) : !filteredColumns.length ? (
        <Card size="small">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={boardQuery.data?.meta?.message || 'Chưa có dữ liệu pipeline'}
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${Math.max(filteredColumns.length, 1)}, minmax(220px, 1fr))`, alignItems: 'start' }}>
          {filteredColumns.map((col) => (
            <Card
              key={col.id}
              size="small"
              title={<Space><span>{col.title}</span><Tag>{col.cards.length}</Tag></Space>}
              bodyStyle={{ padding: 8, minHeight: 220 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!draggingCard) return;
                moveMutation.mutate({ card: draggingCard, targetColumnId: col.id });
                setDraggingCard(null);
              }}
            >
              {col.cards.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Trống" />
              ) : (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {col.cards.map((card) => (
                    <div
                      key={`${col.id}-${card.entity_id}`}
                      draggable
                      onDragStart={() => setDraggingCard(card)}
                      onDragEnd={() => setDraggingCard(null)}
                      style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, background: '#fafafa' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Tag color="blue" style={{ marginInlineEnd: 0 }}>{card.entity_code}</Tag>
                        <Tag style={{ marginInlineEnd: 0 }}>{card.order_status}</Tag>
                      </div>
                      <div style={{ fontSize: 12, color: '#595959', marginBottom: 4 }}>{card.current_step}</div>
                      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>
                        {card.owner || 'Chưa có owner'}{card.team ? ` • ${card.team}` : ''}
                      </div>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        <Space size={4} wrap>
                          {renderSlaTag(card)}
                          {card.current_task_due_date && <Tag>{dayjs(card.current_task_due_date).format('DD/MM/YYYY')}</Tag>}
                        </Space>
                        {col.id !== 'done' && col.id !== 'failed' && (
                          <Button
                            size="small"
                            icon={<SwapRightOutlined />}
                            loading={advanceMutation.isPending}
                            onClick={() => advanceMutation.mutate(card)}
                            style={{ width: '100%' }}
                          >
                            Chuyển bước tiếp
                          </Button>
                        )}
                        <Button
                          size="small"
                          icon={<ProjectOutlined />}
                          onClick={() => setSelectedCard(card)}
                          style={{ width: '100%' }}
                        >
                          Mở công việc
                        </Button>
                        <Button
                          size="small"
                          icon={<HistoryOutlined />}
                          onClick={() => setTimelineCard(card)}
                          style={{ width: '100%' }}
                        >
                          Timeline
                        </Button>
                        {col.id !== 'failed' && (
                          <Button
                            size="small"
                            danger
                            icon={<WarningOutlined />}
                            loading={moveMutation.isPending}
                            onClick={() => moveMutation.mutate({ card, targetColumnId: 'failed' })}
                            style={{ width: '100%' }}
                          >
                            Đánh dấu Failed
                          </Button>
                        )}
                        {col.id === 'failed' && (
                          <Button
                            size="small"
                            icon={<SwapRightOutlined />}
                            loading={retryFailedMutation.isPending}
                            onClick={() => retryFailedMutation.mutate(card)}
                            style={{ width: '100%' }}
                          >
                            Khôi phục xử lý
                          </Button>
                        )}
                      </Space>
                    </div>
                  ))}
                </Space>
              )}
            </Card>
          ))}
        </div>
      )}

      <TaskWorkspaceModal
        open={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        entityType={effectiveEntityType}
        entityId={selectedCard?.entity_id ?? null}
        entityCode={selectedCard?.entity_code}
        titlePrefix="Pipeline Workflow"
      />

      <Drawer
        title={timelineCard ? `Timeline - ${timelineCard.entity_code}` : 'Timeline'}
        width={520}
        open={!!timelineCard}
        onClose={() => setTimelineCard(null)}
        destroyOnClose
      >
        {timelineQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <List<WorkflowPipelineTimelineItem>
            dataSource={timelineQuery.data?.items ?? []}
            locale={{ emptyText: 'Chưa có sự kiện' }}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space size={8} wrap>
                      <Tag color="blue">{item.action}</Tag>
                      <Text>{item.from_step || '-'}</Text>
                      <SwapRightOutlined />
                      <Text>{item.to_step || '-'}</Text>
                    </Space>
                  }
                  description={
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                        <div>{item.actor || 'System'} • {item.created_at ? dayjs(item.created_at).format('DD/MM/YYYY HH:mm') : ''}</div>
                      {item.note ? <div>{item.note}</div> : null}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>
    </div>
  );
}
