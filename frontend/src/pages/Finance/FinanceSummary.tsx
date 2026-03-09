import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Popconfirm, Space, Spin, Switch, Tag, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import axiosInstance from '../../api/axios';
import { financeApi } from '../../api/finance';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { canManageFinanceData } from '../../utils/authz';
import type { AdvanceReminderPolicySimulationResponse } from '../../types/finance';

type FinanceMonthlySummary = {
  month: string;
  total_income: string;
  total_expense: string;
  total_transfer: string;
  cash_delta: string;
  total_advance: string;
  total_settlement_spent: string;
  total_settlement_refund: string;
  advance_net_delta: string;
  transactions_count: number;
  advances_count: number;
  settlements_count: number;
};

type FinanceTrendPoint = {
  month: string;
  total_income: string;
  total_expense: string;
  cash_delta: string;
  total_advance: string;
  total_settlement_spent: string;
  total_settlement_refund: string;
  advance_net_delta: string;
};

type FinanceTrendResponse = {
  end_month: string;
  items: FinanceTrendPoint[];
};

type OverdueParams = {
  as_of?: string;
  overdue_days?: number;
};

const now = new Date();
const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

function money(value: string): string {
  return `${Number(value || 0).toLocaleString('vi-VN')} đ`;
}

const { TextArea } = Input;

export default function FinanceSummary() {
  const [messageApi, contextHolder] = message.useMessage();
  const { config, saveConfig } = useUserPreferences('finance-summary');
  const [month, setMonth] = useState<string>(String((config as Record<string, unknown>)?.month || defaultMonth));
  const [historyAsOfFrom, setHistoryAsOfFrom] = useState<string>('');
  const [historyAsOfTo, setHistoryAsOfTo] = useState<string>('');
  const [historyUnreadOnly, setHistoryUnreadOnly] = useState<boolean>(false);
  const [policyDefaultThreshold, setPolicyDefaultThreshold] = useState<string>('');
  const [policyCooldownHours, setPolicyCooldownHours] = useState<string>('');
  const [policyRoleThresholdJson, setPolicyRoleThresholdJson] = useState<string>('');
  const [policyUserThresholdJson, setPolicyUserThresholdJson] = useState<string>('');
  const [policySimulation, setPolicySimulation] = useState<AdvanceReminderPolicySimulationResponse | null>(null);
  const [policySimulationCompare, setPolicySimulationCompare] = useState<{
    recommendedKey: string;
    current: AdvanceReminderPolicySimulationResponse;
    recommended: AdvanceReminderPolicySimulationResponse;
  } | null>(null);
  const [lastRecommendationRollbackAuditId, setLastRecommendationRollbackAuditId] = useState<number | null>(null);
  const [lastRecommendationPresetKey, setLastRecommendationPresetKey] = useState<string>('');
  const [lastRecommendationUndoInfo, setLastRecommendationUndoInfo] = useState<{
    source: 'toast' | 'button';
    at: string;
    presetKey: string;
  } | null>(null);
  const policyActionThrottleLockRef = useRef<boolean>(false);
  const policyActionThrottleTimerRef = useRef<number | null>(null);
  const canManage = canManageFinanceData();
  const runPolicyActionWithThrottle = (action: () => void): void => {
    if (policyActionThrottleLockRef.current) {
      return;
    }
    policyActionThrottleLockRef.current = true;
    if (policyActionThrottleTimerRef.current) {
      window.clearTimeout(policyActionThrottleTimerRef.current);
    }
    policyActionThrottleTimerRef.current = window.setTimeout(() => {
      policyActionThrottleLockRef.current = false;
      policyActionThrottleTimerRef.current = null;
    }, 500);
    action();
  };
  useEffect(() => {
    return () => {
      if (policyActionThrottleTimerRef.current) {
        window.clearTimeout(policyActionThrottleTimerRef.current);
        policyActionThrottleTimerRef.current = null;
      }
      policyActionThrottleLockRef.current = false;
    };
  }, []);
  const policyCompareDiff = (() => {
    if (!policySimulationCompare) return null;
    const currentUsers = new Set(policySimulationCompare.current.would_send_usernames || []);
    const recommendedUsers = new Set(policySimulationCompare.recommended.would_send_usernames || []);
    const addedUsers: string[] = [];
    const removedUsers: string[] = [];
    const unchangedUsers: string[] = [];
    recommendedUsers.forEach((username) => {
      if (!currentUsers.has(username)) {
        addedUsers.push(username);
        return;
      }
      unchangedUsers.push(username);
    });
    currentUsers.forEach((username) => {
      if (!recommendedUsers.has(username)) {
        removedUsers.push(username);
      }
    });
    addedUsers.sort();
    removedUsers.sort();
    unchangedUsers.sort();
    return { addedUsers, removedUsers, unchangedUsers };
  })();

  const summaryQuery = useQuery({
    queryKey: ['finance-monthly-summary', month],
    queryFn: async (): Promise<FinanceMonthlySummary> => {
      const response = await axiosInstance.get('/finance/cash-transactions/monthly_summary/', {
        params: { month },
      });
      return response.data as FinanceMonthlySummary;
    },
  });
  const trendQuery = useQuery({
    queryKey: ['finance-trend-12m', month],
    queryFn: async (): Promise<FinanceTrendResponse> => {
      const response = await axiosInstance.get('/finance/cash-transactions/trend_12m/', {
        params: { end_month: month },
      });
      return response.data as FinanceTrendResponse;
    },
  });
  const overdueParams: OverdueParams = useMemo(() => {
    const [y, m] = month.split('-');
    if (!y || !m) return { overdue_days: 30 };
    const yearNum = Number(y);
    const monthNum = Number(m);
    if (!Number.isFinite(yearNum) || !Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
      return { overdue_days: 30 };
    }
    const lastDay = new Date(yearNum, monthNum, 0).toISOString().slice(0, 10);
    return { as_of: lastDay, overdue_days: 30 };
  }, [month]);
  const overdueQuery = useQuery({
    queryKey: ['finance-overdue-report', overdueParams],
    queryFn: () => financeApi.getAdvanceOverdueReport(overdueParams),
  });
  const overdueOverviewQuery = useQuery({
    queryKey: ['finance-overdue-overview', overdueParams.as_of],
    queryFn: () => financeApi.getAdvanceOverdueOverview({ as_of: overdueParams.as_of }),
  });
  const lockedMonthsQuery = useQuery({
    queryKey: ['finance-locked-months'],
    queryFn: () => financeApi.getFinanceLockedMonths(),
  });
  const reconciliationQuery = useQuery({
    queryKey: ['finance-payroll-reconciliation', month],
    queryFn: () => financeApi.getPayrollReconciliation(month),
  });
  const reminderHistoryQuery = useQuery({
    queryKey: ['finance-reminder-history', historyAsOfFrom, historyAsOfTo, historyUnreadOnly],
    queryFn: () =>
      financeApi.getAdvanceReminderHistory({
        days: 60,
        as_of_from: historyAsOfFrom || undefined,
        as_of_to: historyAsOfTo || undefined,
        unread_only: historyUnreadOnly || undefined,
      }),
  });
  const approvalQueueQuery = useQuery({
    queryKey: ['finance-advance-approval-queue'],
    queryFn: () => financeApi.getAdvanceApprovalQueue(),
    enabled: canManage,
  });
  const approvalSlaOverviewQuery = useQuery({
    queryKey: ['finance-advance-approval-sla-overview'],
    queryFn: () => financeApi.getAdvanceApprovalSlaOverview(),
    enabled: canManage,
  });
  const reminderPolicyQuery = useQuery({
    queryKey: ['finance-reminder-policy'],
    queryFn: () => financeApi.getAdvanceReminderPolicy(),
    enabled: canManage,
  });
  const reminderPolicyHistoryQuery = useQuery({
    queryKey: ['finance-reminder-policy-history'],
    queryFn: () => financeApi.getAdvanceReminderPolicyHistory({ limit: 10 }),
    enabled: canManage,
  });
  const policyPresets = useMemo(
    () => Object.entries(reminderPolicyQuery.data?.presets || {}),
    [reminderPolicyQuery.data?.presets]
  );
  const applyPolicyDraft = (policy?: {
    default_threshold_days?: number;
    cooldown_hours?: number;
    role_threshold_days?: Record<string, number>;
    user_threshold_days?: Record<string, number>;
  }) => {
    if (!policy) return;
    setPolicyDefaultThreshold(String(policy.default_threshold_days ?? 90));
    setPolicyCooldownHours(String(policy.cooldown_hours ?? 24));
    setPolicyRoleThresholdJson(JSON.stringify(policy.role_threshold_days ?? {}, null, 2));
    setPolicyUserThresholdJson(JSON.stringify(policy.user_threshold_days ?? {}, null, 2));
  };
  const buildPolicyDraftPayload = () => {
    const roleMap = JSON.parse(
      policyRoleThresholdJson || JSON.stringify(reminderPolicyQuery.data?.role_threshold_days ?? {})
    ) as Record<string, number>;
    const userMap = JSON.parse(
      policyUserThresholdJson || JSON.stringify(reminderPolicyQuery.data?.user_threshold_days ?? {})
    ) as Record<string, number>;
    return {
      default_threshold_days: Number(policyDefaultThreshold || reminderPolicyQuery.data?.default_threshold_days || 90),
      cooldown_hours: Number(policyCooldownHours || reminderPolicyQuery.data?.cooldown_hours || 24),
      role_threshold_days: roleMap,
      user_threshold_days: userMap,
    };
  };
  const resendReminderMutation = useMutation({
    mutationFn: (asOf: string) => financeApi.remindOverdueAdvances({ threshold_days: 90, as_of: asOf }),
    onSuccess: async (data) => {
      messageApi.success(`Đã gửi nhắc lại: ${data.sent_count} người nhận`);
      await reminderHistoryQuery.refetch();
    },
    onError: () => messageApi.error('Gửi nhắc lại thất bại'),
  });
  const targetUserReminderMutation = useMutation({
    mutationFn: (username: string) =>
      financeApi.remindOverdueAdvances({
        threshold_days: 90,
        as_of: overdueParams.as_of,
        recipient_usernames: [username],
      }),
    onSuccess: async (data, username) => {
      messageApi.success(`Đã nhắc lại ${username}: ${data.sent_count} thông báo`);
      await reminderHistoryQuery.refetch();
    },
    onError: () => messageApi.error('Gửi nhắc theo người thất bại'),
  });
  const exportReminderHistoryMutation = useMutation({
    mutationFn: () =>
      financeApi.exportAdvanceReminderHistoryExcel({
        days: 60,
        as_of_from: historyAsOfFrom || undefined,
        as_of_to: historyAsOfTo || undefined,
        unread_only: historyUnreadOnly || undefined,
      }),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'lich_su_nhac_qua_han.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      messageApi.success('Đã xuất Excel lịch sử nhắc quá hạn');
    },
    onError: () => messageApi.error('Xuất Excel lịch sử nhắc thất bại'),
  });
  const approveAdvanceLevel1Mutation = useMutation({
    mutationFn: (id: number) => financeApi.approveAdvanceLevel1(id),
    onSuccess: async () => {
      messageApi.success('Đã duyệt cấp 1 phiếu tạm ứng');
      await approvalQueueQuery.refetch();
      await overdueOverviewQuery.refetch();
    },
    onError: () => messageApi.error('Duyệt cấp 1 thất bại'),
  });
  const approveAdvanceLevel2Mutation = useMutation({
    mutationFn: (id: number) => financeApi.approveAdvanceLevel2(id),
    onSuccess: async () => {
      messageApi.success('Đã duyệt cấp 2 phiếu tạm ứng');
      await approvalQueueQuery.refetch();
      await overdueOverviewQuery.refetch();
    },
    onError: () => messageApi.error('Duyệt cấp 2 thất bại'),
  });
  const rejectAdvanceApprovalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => financeApi.rejectAdvanceApproval(id, reason),
    onSuccess: async () => {
      messageApi.success('Đã từ chối duyệt phiếu');
      await approvalQueueQuery.refetch();
    },
    onError: () => messageApi.error('Từ chối duyệt thất bại'),
  });
  const remindPendingApprovalsMutation = useMutation({
    mutationFn: () => financeApi.remindAdvancePendingApprovals({ dry_run: false }),
    onSuccess: async (data) => {
      messageApi.success(`Đã gửi nhắc SLA duyệt tài chính: ${data.sent_count} người nhận`);
      await approvalSlaOverviewQuery.refetch();
      await approvalQueueQuery.refetch();
    },
    onError: () => messageApi.error('Gửi nhắc SLA duyệt thất bại'),
  });
  const saveReminderPolicyMutation = useMutation({
    mutationFn: async () => {
      return financeApi.saveAdvanceReminderPolicy(buildPolicyDraftPayload());
    },
    onSuccess: async () => {
      messageApi.success('Đã lưu policy nhắc quá hạn');
      setLastRecommendationRollbackAuditId(null);
      setLastRecommendationPresetKey('');
      await reminderPolicyQuery.refetch();
      await reminderPolicyHistoryQuery.refetch();
    },
    onError: () => messageApi.error('Lưu policy thất bại (kiểm tra JSON role/user)'),
  });
  const simulateReminderPolicyMutation = useMutation({
    mutationFn: () =>
      financeApi.simulateAdvanceReminderPolicy({
        as_of: overdueParams.as_of,
        policy: buildPolicyDraftPayload(),
      }),
    onSuccess: (data) => {
      setPolicySimulation(data);
      setPolicySimulationCompare(null);
      messageApi.success(`Mô phỏng xong: dự kiến gửi ${data.would_send_count} người`);
    },
    onError: () => messageApi.error('Mô phỏng policy thất bại (kiểm tra JSON role/user)'),
  });
  const runRecommendationCompare = async () => {
    const currentPolicy = buildPolicyDraftPayload();
    const recommendation = reminderPolicyQuery.data?.recommendation;
    if (!recommendation?.preset) {
      throw new Error('NO_RECOMMENDATION');
    }
    const recommendedPolicy = recommendation.preset;
    const [currentResult, recommendedResult] = await Promise.all([
      financeApi.simulateAdvanceReminderPolicy({
        as_of: overdueParams.as_of,
        policy: currentPolicy,
      }),
      financeApi.simulateAdvanceReminderPolicy({
        as_of: overdueParams.as_of,
        policy: recommendedPolicy,
      }),
    ]);
    return {
      recommendedKey: recommendation.recommended_preset_key || 'balanced',
      currentResult,
      recommendedResult,
      recommendedPolicy,
    };
  };
  const compareRecommendedPolicyMutation = useMutation({
    mutationFn: runRecommendationCompare,
    onSuccess: (data) => {
      setPolicySimulationCompare({
        recommendedKey: data.recommendedKey,
        current: data.currentResult,
        recommended: data.recommendedResult,
      });
      setPolicySimulation(data.recommendedResult);
      applyPolicyDraft(data.recommendedPolicy);
      const delta = (data.recommendedResult.would_send_count || 0) - (data.currentResult.would_send_count || 0);
      messageApi.success(
        `Đã áp dụng gợi ý ${data.recommendedKey}. Chênh lệch dự kiến gửi: ${delta >= 0 ? '+' : ''}${delta}`
      );
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'NO_RECOMMENDATION') {
        messageApi.warning('Hiện chưa có recommendation để so sánh');
        return;
      }
      messageApi.error('Không thể so sánh gợi ý (kiểm tra JSON role/user)');
    },
  });
  const compareAndSaveRecommendedPolicyMutation = useMutation({
    mutationFn: async () => {
      const compareResult = await runRecommendationCompare();
      await financeApi.saveAdvanceReminderPolicy(compareResult.recommendedPolicy);
      return compareResult;
    },
    onSuccess: async (data) => {
      setPolicySimulationCompare({
        recommendedKey: data.recommendedKey,
        current: data.currentResult,
        recommended: data.recommendedResult,
      });
      setPolicySimulation(data.recommendedResult);
      applyPolicyDraft(data.recommendedPolicy);
      const delta = (data.recommendedResult.would_send_count || 0) - (data.currentResult.would_send_count || 0);
      await reminderPolicyQuery.refetch();
      const historyResult = await reminderPolicyHistoryQuery.refetch();
      const latestAuditId = historyResult.data?.items?.[0]?.id;
      if (typeof latestAuditId === 'number') {
        setLastRecommendationRollbackAuditId(latestAuditId);
        setLastRecommendationPresetKey(data.recommendedKey);
        setLastRecommendationUndoInfo(null);
      } else {
        setLastRecommendationRollbackAuditId(null);
        setLastRecommendationPresetKey('');
      }
      const successMessageKey = 'policy-compare-save-success';
      messageApi.open({
        key: successMessageKey,
        type: 'success',
        duration: 6,
        content: (
          <Space size={8}>
            <span>{`Đã so sánh và lưu gợi ý ${data.recommendedKey}. Δ gửi ${delta >= 0 ? '+' : ''}${delta}`}</span>
            <Button
              size="small"
              disabled={undoLastRecommendedSaveMutation.isPending || compareAndSaveRecommendedPolicyMutation.isPending}
              onClick={() => {
                if (undoLastRecommendedSaveMutation.isPending || compareAndSaveRecommendedPolicyMutation.isPending) {
                  return;
                }
                if (!window.confirm('Bạn có chắc muốn hoàn tác lần lưu gợi ý vừa thực hiện?')) {
                  return;
                }
                messageApi.destroy(successMessageKey);
                runPolicyActionWithThrottle(() => undoLastRecommendedSaveMutation.mutate('toast'));
              }}
            >
              Undo ngay
            </Button>
          </Space>
        ),
      });
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'NO_RECOMMENDATION') {
        messageApi.warning('Hiện chưa có recommendation để lưu');
        return;
      }
      messageApi.error('Không thể so sánh + lưu gợi ý (kiểm tra JSON role/user)');
    },
  });
  const undoLastRecommendedSaveMutation = useMutation({
    mutationFn: async (source: 'toast' | 'button') => {
      if (!lastRecommendationRollbackAuditId) {
        throw new Error('NO_UNDO_TARGET');
      }
      await financeApi.rollbackAdvanceReminderPolicy({ audit_log_id: lastRecommendationRollbackAuditId });
      return source;
    },
    onSuccess: async (source) => {
      const previousPresetKey = lastRecommendationPresetKey || '-';
      setLastRecommendationRollbackAuditId(null);
      setLastRecommendationPresetKey('');
      setLastRecommendationUndoInfo({
        source,
        at: new Date().toISOString(),
        presetKey: previousPresetKey,
      });
      setPolicyDefaultThreshold('');
      setPolicyCooldownHours('');
      setPolicyRoleThresholdJson('');
      setPolicyUserThresholdJson('');
      await reminderPolicyQuery.refetch();
      await reminderPolicyHistoryQuery.refetch();
      messageApi.success('Đã hoàn tác lần lưu gợi ý gần nhất');
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'NO_UNDO_TARGET') {
        messageApi.warning('Chưa có lần lưu gợi ý nào để hoàn tác');
        return;
      }
      messageApi.error('Hoàn tác lưu gợi ý thất bại');
    },
  });
  const rollbackReminderPolicyMutation = useMutation({
    mutationFn: (auditLogId: number) => financeApi.rollbackAdvanceReminderPolicy({ audit_log_id: auditLogId }),
    onSuccess: async () => {
      messageApi.success('Đã rollback policy thành công');
      setLastRecommendationRollbackAuditId(null);
      setLastRecommendationPresetKey('');
      setPolicyDefaultThreshold('');
      setPolicyCooldownHours('');
      setPolicyRoleThresholdJson('');
      setPolicyUserThresholdJson('');
      await reminderPolicyQuery.refetch();
      await reminderPolicyHistoryQuery.refetch();
    },
    onError: () => messageApi.error('Rollback policy thất bại'),
  });
  const isPolicyActionBusy =
    saveReminderPolicyMutation.isPending ||
    simulateReminderPolicyMutation.isPending ||
    compareRecommendedPolicyMutation.isPending ||
    compareAndSaveRecommendedPolicyMutation.isPending ||
    undoLastRecommendedSaveMutation.isPending ||
    rollbackReminderPolicyMutation.isPending;

  const exportMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      const response = await axiosInstance.get('/finance/cash-transactions/monthly_summary/', {
        params: { month, export: 'excel' },
        responseType: 'blob',
      });
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bao_cao_tai_chinh_${month}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
    onSuccess: () => messageApi.success('Đã tải file Excel báo cáo tài chính'),
    onError: () => messageApi.error('Xuất Excel thất bại'),
  });
  const lockMonthMutation = useMutation({
    mutationFn: () => financeApi.lockFinanceMonth(month),
    onSuccess: () => {
      messageApi.success(`Đã khóa sổ tài chính tháng ${month}`);
    },
    onError: () => messageApi.error('Khóa sổ thất bại'),
  });
  const unlockMonthMutation = useMutation({
    mutationFn: () => financeApi.unlockFinanceMonth(month),
    onSuccess: () => {
      messageApi.success(`Đã mở khóa sổ tài chính tháng ${month}`);
    },
    onError: () => messageApi.error('Mở khóa sổ thất bại'),
  });
  const isMonthLocked = (lockedMonthsQuery.data?.months ?? []).includes(month);

  const cards = useMemo(() => {
    const data = summaryQuery.data;
    if (!data) return [];
    return [
      { title: 'Tổng thu', value: money(data.total_income), color: '#389e0d' },
      { title: 'Tổng chi', value: money(data.total_expense), color: '#cf1322' },
      { title: 'Tổng chuyển', value: money(data.total_transfer), color: '#1677ff' },
      { title: 'Chênh lệch thu-chi', value: money(data.cash_delta), color: '#111' },
      { title: 'Tổng tạm ứng', value: money(data.total_advance), color: '#d48806' },
      { title: 'Chi quyết toán', value: money(data.total_settlement_spent), color: '#722ed1' },
      { title: 'Hoàn ứng', value: money(data.total_settlement_refund), color: '#13a8a8' },
      { title: 'Chênh lệch tạm ứng', value: money(data.advance_net_delta), color: '#111' },
    ];
  }, [summaryQuery.data]);
  const trendItems = useMemo(() => trendQuery.data?.items ?? [], [trendQuery.data?.items]);
  const maxAbsCashDelta = useMemo(() => {
    if (trendItems.length === 0) return 1;
    return Math.max(...trendItems.map((item) => Math.abs(Number(item.cash_delta) || 0)), 1);
  }, [trendItems]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Báo cáo tài chính tháng</h2>
          <div style={{ color: '#8c8c8c' }}>Tổng hợp thu/chi và tạm ứng/quyết toán</div>
        </div>
        <Space>
          <Input
            type="month"
            value={month}
            onChange={async (e) => {
              const nextMonth = e.target.value || defaultMonth;
              setMonth(nextMonth);
              await saveConfig({ ...(config as Record<string, unknown>), month: nextMonth });
            }}
            style={{ width: 170 }}
          />
          <Button
            icon={<DownloadOutlined />}
            disabled={!canManage}
            loading={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            Xuất Excel
          </Button>
          <Button
            disabled={!canManage || isMonthLocked}
            loading={lockMonthMutation.isPending}
            onClick={async () => {
              await lockMonthMutation.mutateAsync();
              await lockedMonthsQuery.refetch();
            }}
          >
            Khóa sổ tháng
          </Button>
          <Button
            disabled={!canManage || !isMonthLocked}
            loading={unlockMonthMutation.isPending}
            onClick={async () => {
              await unlockMonthMutation.mutateAsync();
              await lockedMonthsQuery.refetch();
            }}
          >
            Mở khóa sổ
          </Button>
          {isMonthLocked ? <Tag color="red">Đã khóa sổ tháng này</Tag> : <Tag color="green">Tháng đang mở</Tag>}
        </Space>
      </div>

      {summaryQuery.isLoading ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            {cards.map((card) => (
              <div key={card.title} style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#8c8c8c' }}>{card.title}</div>
                <div style={{ fontWeight: 700, fontSize: 20, color: card.color }}>{card.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
              <div style={{ color: '#8c8c8c' }}>Số giao dịch quỹ</div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{summaryQuery.data?.transactions_count ?? 0}</div>
            </div>
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
              <div style={{ color: '#8c8c8c' }}>Số phiếu tạm ứng</div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{summaryQuery.data?.advances_count ?? 0}</div>
            </div>
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
              <div style={{ color: '#8c8c8c' }}>Số phiếu quyết toán</div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{summaryQuery.data?.settlements_count ?? 0}</div>
            </div>
          </div>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#8c8c8c' }}>Tạm ứng quá hạn (mốc 30 ngày)</div>
                <div style={{ fontWeight: 700, fontSize: 20, color: '#cf1322' }}>
                  {overdueQuery.data?.summary?.count ?? 0} phiếu
                </div>
                <div style={{ color: '#cf1322', fontWeight: 600 }}>
                  Còn lại: {money(overdueQuery.data?.summary?.total_remaining || '0')}
                </div>
              </div>
              <Button
                icon={<DownloadOutlined />}
                disabled={!canManage}
                onClick={async () => {
                  try {
                    const blob = await financeApi.exportAdvanceOverdueReportExcel(overdueParams);
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `bao_cao_tam_ung_qua_han_${overdueParams.as_of || month}.xlsx`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                    messageApi.success('Đã xuất báo cáo tạm ứng quá hạn');
                  } catch {
                    messageApi.error('Xuất báo cáo tạm ứng quá hạn thất bại');
                  }
                }}
              >
                Xuất quá hạn
              </Button>
            </div>
          </div>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
            <div style={{ color: '#8c8c8c' }}>Đối soát lương ↔ sổ quỹ</div>
            <div style={{ marginTop: 6 }}>
              Tổng lương đã khóa: <strong>{money(reconciliationQuery.data?.payroll_total || '0')}</strong>
            </div>
            <div>
              Đã hạch toán chi lương: <strong>{money(reconciliationQuery.data?.posted_total || '0')}</strong>
            </div>
            <div style={{ color: Number(reconciliationQuery.data?.delta || 0) === 0 ? '#389e0d' : '#cf1322' }}>
              Chênh lệch: <strong>{money(reconciliationQuery.data?.delta || '0')}</strong>
            </div>
          </div>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
            <div style={{ color: '#8c8c8c', marginBottom: 8 }}>Cảnh báo quá hạn theo mức</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(overdueOverviewQuery.data?.buckets ?? []).map((bucket) => (
                <Tag key={bucket.threshold_days} color={bucket.threshold_days >= 90 ? 'red' : bucket.threshold_days >= 60 ? 'orange' : 'gold'}>
                  {`>= ${bucket.threshold_days} ngày: ${bucket.count} phiếu - ${money(bucket.total_remaining)}`}
                </Tag>
              ))}
            </div>
            <div style={{ marginTop: 8, color: '#8c8c8c' }}>Top quá hạn:</div>
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(overdueOverviewQuery.data?.top_urgent ?? []).slice(0, 5).map((item) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>{`${item.code} - ${item.recipient_name}`}</div>
                  <div style={{ color: '#cf1322' }}>{`${item.days_overdue} ngày - ${money(item.remaining_amount)}`}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
            <div style={{ color: '#8c8c8c', marginBottom: 8 }}>Hàng đợi duyệt tạm ứng</div>
            <div style={{ marginBottom: 8 }}>
              {`Chờ L1: ${approvalQueueQuery.data?.pending_l1_count ?? 0} | Chờ L2: ${approvalQueueQuery.data?.pending_l2_count ?? 0}`}
            </div>
            <div style={{ marginBottom: 8, color: '#8c8c8c' }}>
              {`SLA quá hạn - L1: ${approvalSlaOverviewQuery.data?.overdue_l1_count ?? 0} | L2: ${approvalSlaOverviewQuery.data?.overdue_l2_count ?? 0} | Escalation L1: ${approvalSlaOverviewQuery.data?.escalation_l1_count ?? 0} | Escalation L2: ${approvalSlaOverviewQuery.data?.escalation_l2_count ?? 0} | Lead time TB: ${Number(approvalSlaOverviewQuery.data?.avg_lead_hours ?? 0).toFixed(2)}h`}
            </div>
            <Button
              size="small"
              style={{ marginBottom: 8 }}
              loading={remindPendingApprovalsMutation.isPending}
              onClick={() => remindPendingApprovalsMutation.mutate()}
            >
              Nhắc SLA duyệt ngay
            </Button>
            {(approvalQueueQuery.data?.items ?? []).length === 0 ? (
              <div style={{ color: '#bfbfbf' }}>Không có phiếu nào đang chờ duyệt.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(approvalQueueQuery.data?.items ?? []).slice(0, 8).map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '100px 1fr 160px 130px 220px',
                      gap: 8,
                      alignItems: 'center',
                      borderBottom: '1px dashed #f0f0f0',
                      paddingBottom: 6,
                    }}
                  >
                    <div>{item.code}</div>
                    <div>{item.recipient_name}</div>
                    <div style={{ textAlign: 'right' }}>{money(item.amount)}</div>
                    <div>{item.approval_status}</div>
                    <Space>
                      {item.approval_status === 'PENDING_L1' ? (
                        <Button
                          size="small"
                          loading={approveAdvanceLevel1Mutation.isPending}
                          onClick={() => approveAdvanceLevel1Mutation.mutate(item.id)}
                        >
                          Duyệt L1
                        </Button>
                      ) : null}
                      {item.approval_status === 'PENDING_L2' ? (
                        <Button
                          size="small"
                          type="primary"
                          loading={approveAdvanceLevel2Mutation.isPending}
                          onClick={() => approveAdvanceLevel2Mutation.mutate(item.id)}
                        >
                          Duyệt L2
                        </Button>
                      ) : null}
                      {(item.approval_status === 'PENDING_L1' || item.approval_status === 'PENDING_L2') ? (
                        <Button
                          size="small"
                          danger
                          loading={rejectAdvanceApprovalMutation.isPending}
                          onClick={() => {
                            const reason = window.prompt(`Nhập lý do từ chối phiếu ${item.code}:`, '');
                            if (!reason || !reason.trim()) {
                              return;
                            }
                            rejectAdvanceApprovalMutation.mutate({ id: item.id, reason: reason.trim() });
                          }}
                        >
                          Từ chối
                        </Button>
                      ) : null}
                    </Space>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#8c8c8c', marginBottom: 4 }}>Top người tạo phiếu đang tắc nghẽn</div>
              {(approvalSlaOverviewQuery.data?.top_blocked_submitters ?? []).length === 0 ? (
                <div style={{ color: '#bfbfbf' }}>Không có dữ liệu.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(approvalSlaOverviewQuery.data?.top_blocked_submitters ?? []).map((row) => (
                    <div key={row.username} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 170px 120px', gap: 8 }}>
                      <div>{row.username}</div>
                      <div>{`SL: ${row.pending_count}`}</div>
                      <div>{`Tổng tiền: ${money(row.total_amount)}`}</div>
                      <div>{`Max wait: ${row.max_wait_hours}h`}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Policy nhắc quá hạn</div>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space wrap>
                {policyPresets.map(([presetKey, preset]) => (
                  <Button
                    key={presetKey}
                    disabled={!canManage || isPolicyActionBusy}
                    onClick={() => runPolicyActionWithThrottle(() => applyPolicyDraft(preset))}
                  >
                    {`Preset: ${presetKey}`}
                  </Button>
                ))}
                <Button
                  type="dashed"
                  disabled={!canManage || isPolicyActionBusy || !reminderPolicyQuery.data?.recommendation?.preset}
                  onClick={() =>
                    runPolicyActionWithThrottle(() =>
                      applyPolicyDraft(reminderPolicyQuery.data?.recommendation?.preset)
                    )
                  }
                >
                  {`Áp dụng gợi ý: ${reminderPolicyQuery.data?.recommendation?.recommended_preset_key || 'balanced'}`}
                </Button>
                <Button
                  type="dashed"
                  disabled={!canManage || isPolicyActionBusy || !reminderPolicyQuery.data?.recommendation?.preset}
                  loading={compareRecommendedPolicyMutation.isPending}
                  onClick={() => runPolicyActionWithThrottle(() => compareRecommendedPolicyMutation.mutate())}
                >
                  Áp dụng gợi ý + so sánh
                </Button>
                <Button
                  type="primary"
                  ghost
                  disabled={!canManage || isPolicyActionBusy || !reminderPolicyQuery.data?.recommendation?.preset}
                  loading={compareAndSaveRecommendedPolicyMutation.isPending}
                  onClick={() => runPolicyActionWithThrottle(() => compareAndSaveRecommendedPolicyMutation.mutate())}
                >
                  So sánh + lưu gợi ý
                </Button>
                <Popconfirm
                  title="Hoàn tác lần lưu gợi ý?"
                  description="Thao tác này sẽ rollback về policy trước đó."
                  okText="Hoàn tác"
                  cancelText="Hủy"
                  disabled={!canManage || isPolicyActionBusy || !lastRecommendationRollbackAuditId}
                  onConfirm={() => runPolicyActionWithThrottle(() => undoLastRecommendedSaveMutation.mutate('button'))}
                >
                  <Button
                    danger
                    disabled={!canManage || isPolicyActionBusy || !lastRecommendationRollbackAuditId}
                    loading={undoLastRecommendedSaveMutation.isPending}
                  >
                    Hoàn tác lần lưu gợi ý
                  </Button>
                </Popconfirm>
              </Space>
              {lastRecommendationRollbackAuditId ? (
                <div style={{ color: '#8c8c8c' }}>
                  {`Có thể hoàn tác lần lưu gợi ý "${lastRecommendationPresetKey || '-'}" (audit #${lastRecommendationRollbackAuditId})`}
                </div>
              ) : null}
              {lastRecommendationUndoInfo ? (
                <div style={{ color: '#8c8c8c' }}>
                  {`Đã hoàn tác lần lưu gợi ý "${lastRecommendationUndoInfo.presetKey}" lúc ${new Date(lastRecommendationUndoInfo.at).toLocaleString('vi-VN')} từ ${lastRecommendationUndoInfo.source === 'toast' ? 'toast Undo ngay' : 'nút Hoàn tác'}.`}
                </div>
              ) : null}
              <div style={{ color: '#8c8c8c' }}>
                {`Gợi ý hiện tại: ${reminderPolicyQuery.data?.recommendation?.recommended_preset_key || 'balanced'} | Lý do: ${reminderPolicyQuery.data?.recommendation?.reason || '-'} | Unread 30d: ${Number(reminderPolicyQuery.data?.recommendation?.metrics?.unread_rate_30d || 0).toFixed(2)}%`}
              </div>
              <Space wrap>
                <span style={{ color: '#8c8c8c' }}>Ngưỡng mặc định (ngày)</span>
                <Input
                  value={policyDefaultThreshold || String(reminderPolicyQuery.data?.default_threshold_days ?? 90)}
                  onChange={(e) => setPolicyDefaultThreshold(e.target.value)}
                  style={{ width: 120 }}
                />
                <span style={{ color: '#8c8c8c' }}>Cooldown (giờ)</span>
                <Input
                  value={policyCooldownHours || String(reminderPolicyQuery.data?.cooldown_hours ?? 24)}
                  onChange={(e) => setPolicyCooldownHours(e.target.value)}
                  style={{ width: 120 }}
                />
                <Button
                  type="primary"
                  disabled={!canManage || isPolicyActionBusy}
                  loading={saveReminderPolicyMutation.isPending}
                  onClick={() => runPolicyActionWithThrottle(() => saveReminderPolicyMutation.mutate())}
                >
                  Lưu policy
                </Button>
                <Button
                  disabled={!canManage || isPolicyActionBusy}
                  loading={simulateReminderPolicyMutation.isPending}
                  onClick={() => runPolicyActionWithThrottle(() => simulateReminderPolicyMutation.mutate())}
                >
                  Mô phỏng (dry-run)
                </Button>
              </Space>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ color: '#8c8c8c', marginBottom: 4 }}>Role threshold map (JSON)</div>
                  <TextArea
                    rows={4}
                    value={policyRoleThresholdJson || JSON.stringify(reminderPolicyQuery.data?.role_threshold_days ?? {}, null, 2)}
                    onChange={(e) => setPolicyRoleThresholdJson(e.target.value)}
                  />
                </div>
                <div>
                  <div style={{ color: '#8c8c8c', marginBottom: 4 }}>User threshold map (JSON)</div>
                  <TextArea
                    rows={4}
                    value={policyUserThresholdJson || JSON.stringify(reminderPolicyQuery.data?.user_threshold_days ?? {}, null, 2)}
                    onChange={(e) => setPolicyUserThresholdJson(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ borderTop: '1px dashed #f0f0f0', paddingTop: 8 }}>
                {policySimulationCompare ? (
                  <div style={{ marginBottom: 8, color: '#8c8c8c' }}>
                    {`So sánh (${policySimulationCompare.recommendedKey}): hiện tại ${policySimulationCompare.current.would_send_count} -> gợi ý ${policySimulationCompare.recommended.would_send_count} (Δ ${policySimulationCompare.recommended.would_send_count - policySimulationCompare.current.would_send_count >= 0 ? '+' : ''}${policySimulationCompare.recommended.would_send_count - policySimulationCompare.current.would_send_count})`}
                  </div>
                ) : null}
                {policyCompareDiff ? (
                  <div style={{ marginBottom: 8, color: '#8c8c8c' }}>
                    <div style={{ marginBottom: 4 }}>
                      {`Thêm nhắc: ${policyCompareDiff.addedUsers.length} | Giảm nhắc: ${policyCompareDiff.removedUsers.length} | Giữ nguyên: ${policyCompareDiff.unchangedUsers.length}`}
                    </div>
                    <div>
                      {`Mẫu thêm nhắc: ${policyCompareDiff.addedUsers.slice(0, 5).join(', ') || '-'}`}
                    </div>
                    <div>
                      {`Mẫu giảm nhắc: ${policyCompareDiff.removedUsers.slice(0, 5).join(', ') || '-'}`}
                    </div>
                  </div>
                ) : null}
                {policySimulation ? (
                  <div style={{ marginBottom: 8, color: '#8c8c8c' }}>
                    {`Dự kiến gửi: ${policySimulation.would_send_count} | Skip cooldown: ${(policySimulation.skipped_cooldown_usernames || []).length} | Không quá hạn: ${(policySimulation.skipped_no_overdue_usernames || []).length} | Mẫu người nhận: ${(policySimulation.would_send_usernames || []).slice(0, 5).join(', ') || '-'}`}
                  </div>
                ) : null}
                <div style={{ color: '#8c8c8c', marginBottom: 4 }}>Lịch sử thay đổi policy</div>
                {(reminderPolicyHistoryQuery.data?.items || []).length === 0 ? (
                  <div style={{ color: '#bfbfbf' }}>Chưa có lịch sử thay đổi.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(reminderPolicyHistoryQuery.data?.items || []).map((item) => (
                      <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '190px 140px 1fr auto', gap: 8, alignItems: 'center' }}>
                        <div>{new Date(item.created_at).toLocaleString('vi-VN')}</div>
                        <div>{item.username || '-'}</div>
                        <div>
                          {`default ${item.old_values?.default_threshold_days ?? '-'} -> ${item.new_values?.default_threshold_days ?? '-'}, cooldown ${item.old_values?.cooldown_hours ?? '-'}h -> ${item.new_values?.cooldown_hours ?? '-'}h`}
                        </div>
                        <Button
                          size="small"
                          disabled={!canManage || isPolicyActionBusy}
                          loading={rollbackReminderPolicyMutation.isPending}
                          onClick={() =>
                            runPolicyActionWithThrottle(() => rollbackReminderPolicyMutation.mutate(item.id))
                          }
                        >
                          Rollback
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Space>
          </div>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Lịch sử gửi nhắc quá hạn (60 ngày)</div>
            <Space style={{ marginBottom: 10 }} wrap>
              <Input
                type="date"
                value={historyAsOfFrom}
                onChange={(e) => setHistoryAsOfFrom(e.target.value)}
                style={{ width: 170 }}
                placeholder="Từ ngày nhắc"
              />
              <Input
                type="date"
                value={historyAsOfTo}
                onChange={(e) => setHistoryAsOfTo(e.target.value)}
                style={{ width: 170 }}
                placeholder="Đến ngày nhắc"
              />
              <span style={{ color: '#8c8c8c' }}>Chỉ chưa đọc</span>
              <Switch checked={historyUnreadOnly} onChange={setHistoryUnreadOnly} />
              <Button
                onClick={() => {
                  setHistoryAsOfFrom('');
                  setHistoryAsOfTo('');
                  setHistoryUnreadOnly(false);
                }}
              >
                Xóa lọc
              </Button>
              <Button
                icon={<DownloadOutlined />}
                disabled={!canManage}
                loading={exportReminderHistoryMutation.isPending}
                onClick={() => exportReminderHistoryMutation.mutate()}
              >
                Xuất lịch sử
              </Button>
            </Space>
            <div style={{ marginBottom: 8, color: '#8c8c8c' }}>
              {`Tổng gửi: ${reminderHistoryQuery.data?.summary?.total_sent ?? 0} | Đã đọc: ${reminderHistoryQuery.data?.summary?.total_read ?? 0} | Chưa đọc: ${reminderHistoryQuery.data?.summary?.total_unread ?? 0} | Tỉ lệ đã đọc: ${Number(reminderHistoryQuery.data?.summary?.overall_read_rate ?? 0).toFixed(2)}%`}
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#8c8c8c', marginBottom: 4 }}>Top người nhận chưa đọc</div>
              {(reminderHistoryQuery.data?.summary?.top_unread_recipients ?? []).length === 0 ? (
                <div style={{ color: '#bfbfbf' }}>Không có dữ liệu.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(reminderHistoryQuery.data?.summary?.top_unread_recipients ?? []).slice(0, 5).map((row) => (
                    <div key={row.username} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 8 }}>
                      <div>{row.username}</div>
                      <div style={{ color: '#cf1322' }}>
                        {`Chưa đọc: ${row.unread_count}/${row.total_received} (${Number(row.unread_rate || 0).toFixed(1)}%)`}
                      </div>
                      <Button
                        size="small"
                        disabled={!canManage || !overdueParams.as_of}
                        loading={targetUserReminderMutation.isPending}
                        onClick={() => targetUserReminderMutation.mutate(row.username)}
                      >
                        Nhắc người này
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {(reminderHistoryQuery.data?.items ?? []).length === 0 ? (
              <div style={{ color: '#8c8c8c' }}>Chưa có lịch sử nhắc quá hạn.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(reminderHistoryQuery.data?.items ?? []).slice(0, 6).map((item) => (
                  <div
                    key={`${item.entity_id}-${item.created_at}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '120px 1fr 230px 180px 120px',
                      gap: 10,
                      alignItems: 'center',
                      borderBottom: '1px dashed #f0f0f0',
                      paddingBottom: 6,
                    }}
                  >
                    <div style={{ color: '#8c8c8c' }}>{item.as_of || '-'}</div>
                    <div>{item.title}</div>
                    <div>{`Đã gửi: ${item.sent_count} | Đã đọc: ${item.read_count} (${Number(item.read_rate || 0).toFixed(1)}%) | Chưa đọc: ${item.unread_count}`}</div>
                    <div style={{ color: '#8c8c8c' }}>
                      {(item.recipient_names || []).slice(0, 3).join(', ')}
                    </div>
                    <Button
                      size="small"
                      disabled={!canManage || !item.as_of}
                      loading={resendReminderMutation.isPending}
                      onClick={() => {
                        if (item.as_of) resendReminderMutation.mutate(item.as_of);
                      }}
                    >
                      Gửi lại
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>Xu hướng 12 tháng (thu - chi)</div>
            {trendQuery.isLoading ? (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <Spin />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {trendItems.map((item) => {
                  const delta = Number(item.cash_delta || 0);
                  const widthPercent = Math.max(2, Math.round((Math.abs(delta) / maxAbsCashDelta) * 100));
                  const color = delta >= 0 ? '#389e0d' : '#cf1322';
                  return (
                    <div key={item.month} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 160px', gap: 10, alignItems: 'center' }}>
                      <div style={{ color: '#8c8c8c' }}>{item.month}</div>
                      <div style={{ height: 10, background: '#f5f5f5', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ width: `${widthPercent}%`, height: '100%', background: color }} />
                      </div>
                      <div style={{ textAlign: 'right', color }}>{money(item.cash_delta)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
