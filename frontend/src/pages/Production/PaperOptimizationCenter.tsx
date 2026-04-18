import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Empty,
  Input,
  InputNumber,
  Row,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { paperOptimizerApi } from '../../api/paperOptimizer';
import PageHeader from '../../components/PageHeader/PageHeader';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getToastMessage } from '../../shared/apiError';
import { theme } from '../../styles/theme';
import type {
  PaperOptimizerAllocationDetail,
  PaperOptimizerLine,
  PaperOptimizerPlan,
  PaperOptimizerPreferences,
  PaperOptimizerPreviewResponse,
  PaperOptimizerPurchaseSpecRow,
  PaperOptimizerRawWidthUsageRow,
  PaperOptimizerResultPayload,
  PaperOptimizerReverseCheckRow,
  PaperOptimizerRun,
  PaperOptimizerSupplierConfig,
  PaperOptimizerOptimizationConfig,
} from '../../types/paperOptimizer';

const { Paragraph, Text, Title } = Typography;

const RAW_WIDTH_OPTIONS = Array.from({ length: 35 }, (_, index) => 110 + index * 5);
const MIN_PURCHASE_LENGTH_STANDARD_CM = 5000;
const RAW_WIDTH_COLLAPSED_MAX_HEIGHT = 74;
const PAPER_OPTIMIZER_PAGE_KEY = 'production-paper-optimizer';
const paperTheme = {
  surfaceBase: theme.colors.background,
  surfaceSubtle: theme.colors.backgroundGray,
  surfaceHero: theme.colors.backgroundLight,
  primarySoft: theme.colors.backgroundLight,
  primaryBorder: theme.colors.border,
  successBorder: theme.colors.success,
  warningBorder: theme.colors.warning,
  textMuted: theme.colors.textSecondary,
  shadowXs: theme.shadows.sm,
};

const sectionCardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: `1px solid ${theme.colors.borderLight}`,
  boxShadow: paperTheme.shadowXs,
  background: paperTheme.surfaceBase,
};

type EditorCoreState = {
  inputLines: PaperOptimizerLine[];
  supplierConfig: PaperOptimizerSupplierConfig;
  optimizationConfig: PaperOptimizerOptimizationConfig;
  sourceFilename: string;
  note: string;
};

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseRunId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeLines(lines: PaperOptimizerLine[]): PaperOptimizerLine[] {
  return lines.map((line, index) => ({
    id: String(line.id || index + 1),
    note: line.note || '',
    quantity: Number(line.quantity || 0),
    width_cm: Number(line.width_cm || 0),
    length_cm: Number(line.length_cm || 0),
    source_row_number: index + 1,
  }));
}

function normalizeRawWidths(values: Array<number | string> | undefined | null): number[] {
  if (!values) return [];
  return RAW_WIDTH_OPTIONS.filter((option) =>
    values.some((value) => Number(value) === option),
  );
}

function normalizeSupplierConfig(config: PaperOptimizerSupplierConfig): PaperOptimizerSupplierConfig {
  return {
    ...cloneValue(config),
    min_purchase_length_cm: Math.max(
      MIN_PURCHASE_LENGTH_STANDARD_CM,
      Number(config.min_purchase_length_cm || 0),
    ),
    available_raw_widths_cm: normalizeRawWidths(config.available_raw_widths_cm),
  };
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '-';
  return Number(value).toLocaleString('vi-VN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatFlexibleNumber(value: number | null | undefined, maxDigits = 4): string {
  if (value == null || Number.isNaN(value)) return '-';
  return Number(value).toLocaleString('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDigits,
  });
}

function formatRate(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${(Number(value) * 100).toLocaleString('vi-VN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function buildEditorFingerprint(state: EditorCoreState): string {
  return JSON.stringify({
    inputLines: sanitizeLines(cloneValue(state.inputLines)),
    supplierConfig: cloneValue(state.supplierConfig),
    optimizationConfig: cloneValue(state.optimizationConfig),
    sourceFilename: state.sourceFilename || '',
    note: state.note || '',
  });
}

function buildBlankLine(index: number): PaperOptimizerLine {
  return {
    id: String(index + 1),
    note: '',
    quantity: 1,
    width_cm: 0,
    length_cm: 0,
    source_row_number: index + 1,
  };
}

function buildCoreStateFromRun(run: PaperOptimizerRun): EditorCoreState {
  return {
    inputLines: sanitizeLines(cloneValue(run.input_lines || [])),
    supplierConfig: cloneValue(run.supplier_config || {}),
    optimizationConfig: cloneValue(run.optimization_config || {}),
    sourceFilename: run.source_filename || '',
    note: run.note || '',
  };
}

function MetricCard(props: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: 'primary' | 'success' | 'warning' | 'neutral';
}) {
  const { label, value, hint, accent = 'neutral' } = props;
  const tones = {
    primary: [paperTheme.primarySoft, paperTheme.primaryBorder],
    success: [theme.colors.successLight, paperTheme.successBorder],
    warning: [theme.colors.warningLight, paperTheme.warningBorder],
    neutral: [paperTheme.surfaceSubtle, theme.colors.borderLight],
  } as const;

  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${tones[accent][1]}`,
        background: tones[accent][0],
        padding: 10,
        minHeight: 84,
      }}
    >
      <Text style={{ color: paperTheme.textMuted, fontSize: 12, fontWeight: 700 }}>{label}</Text>
      <div style={{ marginTop: 8, fontSize: 22, fontWeight: 800 }}>{value}</div>
      {hint ? <Paragraph style={{ margin: '6px 0 0', color: theme.colors.textSecondary }}>{hint}</Paragraph> : null}
    </div>
  );
}

function SectionCard(props: {
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const { step, title, description, children, extra } = props;
  return (
    <Card style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: 700, color: paperTheme.textMuted, textTransform: 'uppercase' }}>
            {step}
          </Text>
          <Title level={4} style={{ margin: 0 }}>
            {title}
          </Title>
          <Paragraph style={{ margin: 0, color: theme.colors.textSecondary }}>{description}</Paragraph>
        </div>
        {extra}
      </div>
      {children}
    </Card>
  );
}

export default function PaperOptimizationCenter() {
  const { message, modal } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const runId = parseRunId(searchParams.get('run_id'));
  const initializedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputSectionRef = useRef<HTMLDivElement | null>(null);
  const configSectionRef = useRef<HTMLDivElement | null>(null);
  const resultSectionRef = useRef<HTMLDivElement | null>(null);
  const resultSpotlightTimerRef = useRef<number | null>(null);
  const optimizeUiStartRef = useRef<number | null>(null);
  const optimizeUiTimerRef = useRef<number | null>(null);

  const [inputLines, setInputLines] = useState<PaperOptimizerLine[]>([]);
  const [supplierConfig, setSupplierConfig] = useState<PaperOptimizerSupplierConfig>({});
  const [optimizationConfig, setOptimizationConfig] = useState<PaperOptimizerOptimizationConfig>({});
  const [sourceFilename, setSourceFilename] = useState('');
  const [note, setNote] = useState('');
  const [previewReport, setPreviewReport] = useState<PaperOptimizerPreviewResponse | null>(null);
  const [currentRun, setCurrentRun] = useState<PaperOptimizerRun | null>(null);
  const [editorBaselineFingerprint, setEditorBaselineFingerprint] = useState('');
  const [exporting, setExporting] = useState(false);
  const [rawWidthExpanded, setRawWidthExpanded] = useState(false);
  const [optimizingUiVisible, setOptimizingUiVisible] = useState(false);
  const [resultTabKey, setResultTabKey] = useState('purchase');
  const [pendingResultFocus, setPendingResultFocus] = useState(false);
  const [resultSpotlightActive, setResultSpotlightActive] = useState(false);
  const [noFeasibleDebugOpen, setNoFeasibleDebugOpen] = useState(false);

  const { config, isLoading: preferencesLoading, saveConfig } = useUserPreferences(PAPER_OPTIMIZER_PAGE_KEY);

  const defaultsQuery = useQuery({
    queryKey: ['paper-optimizer-defaults'],
    queryFn: () => paperOptimizerApi.getDefaults(),
    staleTime: 5 * 60 * 1000,
  });

  const runQuery = useQuery({
    queryKey: ['paper-optimizer-run', runId],
    queryFn: () => paperOptimizerApi.getRun(runId as number),
    enabled: Boolean(runId),
  });

  const applyEditorState = useCallback((nextState: EditorCoreState, options?: {
    previewReport?: PaperOptimizerPreviewResponse | null;
    run?: PaperOptimizerRun | null;
    clearRunSelection?: boolean;
  }) => {
    const normalizedState: EditorCoreState = {
      inputLines: sanitizeLines(cloneValue(nextState.inputLines)),
      supplierConfig: normalizeSupplierConfig(nextState.supplierConfig),
      optimizationConfig: cloneValue(nextState.optimizationConfig),
      sourceFilename: nextState.sourceFilename || '',
      note: nextState.note || '',
    };

    setInputLines(normalizedState.inputLines);
    setSupplierConfig(normalizedState.supplierConfig);
    setOptimizationConfig(normalizedState.optimizationConfig);
    setSourceFilename(normalizedState.sourceFilename);
    setNote(normalizedState.note);
    setPreviewReport(options?.previewReport ?? null);
    setCurrentRun(options?.run ?? null);
    setEditorBaselineFingerprint(buildEditorFingerprint(normalizedState));
    setNoFeasibleDebugOpen(false);

    if (options?.clearRunSelection) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('run_id');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (initializedRef.current || defaultsQuery.isLoading || preferencesLoading) return;
    const defaults = defaultsQuery.data;
    if (!defaults) return;
    const preferenceConfig = (config || {}) as PaperOptimizerPreferences;
    applyEditorState({
      inputLines: preferenceConfig.inputLines || defaults.input_lines || [],
      supplierConfig: preferenceConfig.supplierConfig || defaults.supplier_config || {},
      optimizationConfig: preferenceConfig.optimizationConfig || defaults.optimization_config || {},
      sourceFilename: preferenceConfig.sourceFilename || '',
      note: preferenceConfig.note || '',
    });
    initializedRef.current = true;
  }, [applyEditorState, config, defaultsQuery.data, defaultsQuery.isLoading, preferencesLoading]);

  useEffect(() => {
    if (!runQuery.data) return;
    const run = runQuery.data;
    initializedRef.current = true;
    setCurrentRun(run);
    applyEditorState(buildCoreStateFromRun(run), {
      previewReport: null,
      run,
      clearRunSelection: false,
    });
  }, [applyEditorState, runQuery.data]);

  useEffect(() => {
    if (!initializedRef.current) return;
    const timer = window.setTimeout(() => {
      void saveConfig({
        inputLines,
        supplierConfig,
        optimizationConfig,
        sourceFilename,
        note,
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [inputLines, supplierConfig, optimizationConfig, sourceFilename, note, saveConfig]);

  const optimizeMutation = useMutation({
    mutationFn: (payload: Parameters<typeof paperOptimizerApi.optimize>[0]) => paperOptimizerApi.optimize(payload),
    onMutate: () => {
      initializedRef.current = true;
      optimizeUiStartRef.current = window.performance.now();
      if (optimizeUiTimerRef.current) {
        window.clearTimeout(optimizeUiTimerRef.current);
        optimizeUiTimerRef.current = null;
      }
      setOptimizingUiVisible(true);
      setResultTabKey('purchase');
      setResultSpotlightActive(false);
      setNoFeasibleDebugOpen(false);
    },
    onSuccess: (run) => {
      setCurrentRun(run);
      setEditorBaselineFingerprint(buildEditorFingerprint(buildCoreStateFromRun(run)));
      setResultTabKey('purchase');
      setPendingResultFocus(true);
      setNoFeasibleDebugOpen(false);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('run_id');
      setSearchParams(nextParams, { replace: true });
      const elapsed = optimizeUiStartRef.current == null ? 0 : window.performance.now() - optimizeUiStartRef.current;
      const remainingDelay = Math.max(0, 260 - elapsed);
      optimizeUiTimerRef.current = window.setTimeout(() => {
        setOptimizingUiVisible(false);
        optimizeUiStartRef.current = null;
        optimizeUiTimerRef.current = null;
      }, remainingDelay);
      message.success(`Đã sinh phương án ${run.code}.`);
    },
    onError: (error) => {
      const elapsed = optimizeUiStartRef.current == null ? 0 : window.performance.now() - optimizeUiStartRef.current;
      const remainingDelay = Math.max(0, 260 - elapsed);
      optimizeUiTimerRef.current = window.setTimeout(() => {
        setOptimizingUiVisible(false);
        optimizeUiStartRef.current = null;
        optimizeUiTimerRef.current = null;
      }, remainingDelay);
      message.error(getToastMessage(error));
    },
  });

  const uploadPreviewMutation = useMutation({
    mutationFn: (file: File) => paperOptimizerApi.uploadPreview(file),
    onSuccess: (preview) => {
      initializedRef.current = true;
      setPreviewReport(preview);
      setInputLines(sanitizeLines(preview.rows || []));
      setSourceFilename(preview.source_filename || '');
      setCurrentRun(null);
      message.success(
        `Đã nạp ${formatNumber(preview.summary.accepted_row_count)} dòng hợp lệ. ${
          preview.summary.issue_count ? `Có ${formatNumber(preview.summary.issue_count)} dòng cần xem lại.` : ''
        }`.trim(),
      );
    },
    onError: (error) => {
      message.error(getToastMessage(error));
    },
  });

  const activePayload: PaperOptimizerResultPayload | null = currentRun?.result_payload || null;
  const selectedPlan = activePayload?.selected_plan || null;
  const stats = activePayload?.stats || {};
  const comparePlans = activePayload?.final_plan_alternatives || [];
  const purchaseSpecRows = (activePayload?.purchase_spec_rows || selectedPlan?.purchase_spec_rows || []) as PaperOptimizerPurchaseSpecRow[];
  const allocationRows = (activePayload?.allocation_details || selectedPlan?.allocation_details || []) as PaperOptimizerAllocationDetail[];
  const reverseRows = (activePayload?.reverse_check_rows || selectedPlan?.reverse_check_rows || []) as PaperOptimizerReverseCheckRow[];
  const rawWidthRows = (selectedPlan?.raw_width_usage_summary || []) as PaperOptimizerRawWidthUsageRow[];
  const leftovers = activePayload?.leftovers || [];
  const resultState = useMemo<'success' | 'no_feasible_candidate' | null>(() => {
    if (currentRun?.status !== 'SUCCESS') return null;
    if (activePayload?.result_state === 'success' || activePayload?.result_state === 'no_feasible_candidate') {
      return activePayload.result_state;
    }
    if (stats.no_feasible_candidate) return 'no_feasible_candidate';
    return 'success';
  }, [activePayload?.result_state, currentRun?.status, stats.no_feasible_candidate]);
  const isNoFeasibleResult = currentRun?.status === 'SUCCESS' && resultState === 'no_feasible_candidate';
  const hasDisplayableResult = Boolean(
    currentRun?.status === 'SUCCESS'
    && resultState === 'success'
    && stats.displayable_result !== false
    && purchaseSpecRows.length > 0,
  );
  const hasVisibleResultData = hasDisplayableResult;
  const successWithoutVisibleRows = Boolean(
    currentRun?.status === 'SUCCESS'
    && resultState === 'success'
    && !hasDisplayableResult,
  );
  const canExportCurrentRun = Boolean(
    currentRun
    && currentRun.status === 'SUCCESS'
    && resultState === 'success'
    && stats.displayable_result !== false
    && purchaseSpecRows.length > 0,
  );
  const selectedRawWidths = useMemo(
    () => normalizeRawWidths(supplierConfig.available_raw_widths_cm),
    [supplierConfig.available_raw_widths_cm],
  );
  const defaultRawWidthPreset = useMemo(
    () => normalizeRawWidths(defaultsQuery.data?.supplier_config?.available_raw_widths_cm),
    [defaultsQuery.data?.supplier_config?.available_raw_widths_cm],
  );
  const failedPurchaseSpecCount =
    purchaseSpecRows.filter((row) => row.supplier_min_length_passed === false).length
    || Number(stats.purchase_spec_ncc_failed_count || 0);
  const selectedPlanSummaryValue = isNoFeasibleResult ? 'Chưa có phương án đạt NCC' : (selectedPlan?.plan_name || '-');
  const summaryTotalCostValue = isNoFeasibleResult ? '-' : formatFlexibleNumber(selectedPlan?.total_converted_cost, 8);

  const editorCoreState: EditorCoreState = useMemo(() => ({
    inputLines,
    supplierConfig,
    optimizationConfig,
    sourceFilename,
    note,
  }), [inputLines, supplierConfig, optimizationConfig, sourceFilename, note]);

  const isDirty = buildEditorFingerprint(editorCoreState) !== editorBaselineFingerprint;

  const uiState = useMemo(() => {
    if (optimizingUiVisible) return 'optimizing';
    if (currentRun?.status === 'FAILED') return 'failed';
    if (resultState === 'no_feasible_candidate') return 'no_feasible_candidate';
    if (currentRun?.status === 'SUCCESS') return 'success';
    if (previewReport?.issues?.length) return 'preview_warning';
    if (!inputLines.length) return 'blank';
    return 'ready_to_optimize';
  }, [currentRun?.status, inputLines.length, optimizingUiVisible, previewReport?.issues?.length, resultState]);

  const scrollToRef = (target: React.RefObject<HTMLDivElement | null>) => {
    target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const spotlightResultSection = useCallback(() => {
    setResultTabKey('purchase');
    scrollToRef(resultSectionRef);
    resultSectionRef.current?.focus({ preventScroll: true });
    setResultSpotlightActive(true);
    if (resultSpotlightTimerRef.current) {
      window.clearTimeout(resultSpotlightTimerRef.current);
    }
    resultSpotlightTimerRef.current = window.setTimeout(() => {
      setResultSpotlightActive(false);
      resultSpotlightTimerRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => () => {
    if (resultSpotlightTimerRef.current) {
      window.clearTimeout(resultSpotlightTimerRef.current);
    }
    if (optimizeUiTimerRef.current) {
      window.clearTimeout(optimizeUiTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!pendingResultFocus || optimizingUiVisible || !currentRun) return;
    const timer = window.setTimeout(() => {
      spotlightResultSection();
      setPendingResultFocus(false);
    }, 90);
    return () => window.clearTimeout(timer);
  }, [currentRun, optimizingUiVisible, pendingResultFocus, spotlightResultSection]);

  const uiStateLabel = useMemo(() => {
    switch (uiState) {
      case 'optimizing':
        return 'Đang sinh';
      case 'no_feasible_candidate':
        return 'Chưa khả thi';
      case 'preview_warning':
        return 'Cần xem lại preview';
      case 'ready_to_optimize':
        return 'Sẵn sàng sinh';
      case 'failed':
        return 'Thất bại';
      case 'success':
        return 'Đã có kết quả';
      default:
        return 'Chưa có dữ liệu';
    }
  }, [uiState]);

  const updateInputLine = (index: number, patch: Partial<PaperOptimizerLine>) => {
    initializedRef.current = true;
    setInputLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
  };

  const addInputLine = () => {
    initializedRef.current = true;
    setInputLines((current) => [...current, buildBlankLine(current.length)]);
  };

  const removeInputLine = (index: number) => {
    initializedRef.current = true;
    setInputLines((current) =>
      sanitizeLines(current.filter((_, lineIndex) => lineIndex !== index)),
    );
  };

  const updateSupplierConfig = (patch: Partial<PaperOptimizerSupplierConfig>) => {
    initializedRef.current = true;
    setSupplierConfig((current) => normalizeSupplierConfig({
      ...current,
      ...patch,
    }));
  };

  const updateOptimizationConfig = (patch: Partial<PaperOptimizerOptimizationConfig>) => {
    initializedRef.current = true;
    setOptimizationConfig((current) => ({
      ...current,
      ...patch,
    }));
  };

  const handleUploadFile = async (file: File) => {
    await uploadPreviewMutation.mutateAsync(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownloadImportTemplate = async () => {
    try {
      const blob = await paperOptimizerApi.downloadImportTemplate();
      downloadBlob(blob, 'paper_optimizer_import_template.csv');
    } catch (error) {
      message.error(getToastMessage(error));
    }
  };

  const applyDefaultState = () => {
    const defaults = defaultsQuery.data;
    if (!defaults) return;
    setRawWidthExpanded(false);
    applyEditorState({
      inputLines: defaults.input_lines || [],
      supplierConfig: defaults.supplier_config || {},
      optimizationConfig: defaults.optimization_config || {},
      sourceFilename: '',
      note: '',
    }, {
      previewReport: null,
      run: null,
      clearRunSelection: true,
    });
    message.success('Đã khôi phục cấu hình mặc định của màn hình.');
  };

  const handleResetDefaults = () => {
    if (!isDirty) {
      applyDefaultState();
      return;
    }
    modal.confirm({
      title: 'Khôi phục cấu hình mặc định?',
      content: 'Dữ liệu nhập, cấu hình NCC và cấu hình engine đang chỉnh sẽ được đưa về mặc định của feature này.',
      okText: 'Khôi phục mặc định',
      cancelText: 'Giữ lại',
      onOk: applyDefaultState,
    });
  };

  const handleGenerate = () => {
    optimizeMutation.mutate({
      source_filename: sourceFilename || undefined,
      note: note || undefined,
      input_lines: sanitizeLines(inputLines),
      supplier_config: normalizeSupplierConfig(supplierConfig),
      optimization_config: optimizationConfig,
    });
  };

  const handleExportExcel = async () => {
    if (!currentRun || !canExportCurrentRun) return;
    try {
      setExporting(true);
      const blob = await paperOptimizerApi.exportExcel(currentRun.id);
      downloadBlob(blob, `${currentRun.code.toLowerCase()}.xlsx`);
    } catch (error) {
      message.error(getToastMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const handleFailedRerun = () => {
    if (!currentRun) return;
    optimizeMutation.mutate({
      source_filename: sourceFilename || undefined,
      note: note || undefined,
      input_lines: sanitizeLines(inputLines),
      supplier_config: normalizeSupplierConfig(supplierConfig),
      optimization_config: optimizationConfig,
    });
  };

  const handleToggleRawWidth = (option: number) => {
    const next = selectedRawWidths.includes(option)
      ? selectedRawWidths.filter((value) => value !== option)
      : [...selectedRawWidths, option].sort((left, right) => left - right);
    updateSupplierConfig({ available_raw_widths_cm: next });
  };

  const handleUseAllRawWidths = () => {
    updateSupplierConfig({ available_raw_widths_cm: RAW_WIDTH_OPTIONS });
  };

  const handleUseRecommendedRawWidths = () => {
    updateSupplierConfig({
      available_raw_widths_cm: defaultRawWidthPreset.length ? defaultRawWidthPreset : RAW_WIDTH_OPTIONS,
    });
  };

  const handleClearRawWidths = () => {
    updateSupplierConfig({ available_raw_widths_cm: [] });
  };

  const inputColumns: ColumnsType<PaperOptimizerLine> = [
    {
      title: 'Dòng',
      width: 70,
      render: (_value, _record, index) => index + 1,
    },
    {
      title: 'Khổ',
      width: 120,
      render: (_value, record, index) => (
        <InputNumber
          value={record.width_cm || undefined}
          min={0}
          controls={false}
          style={{ width: '100%' }}
          onChange={(value) => updateInputLine(index, { width_cm: Number(value || 0) })}
        />
      ),
    },
    {
      title: 'Dài',
      width: 120,
      render: (_value, record, index) => (
        <InputNumber
          value={record.length_cm || undefined}
          min={0}
          controls={false}
          style={{ width: '100%' }}
          onChange={(value) => updateInputLine(index, { length_cm: Number(value || 0) })}
        />
      ),
    },
    {
      title: 'Số lượng',
      width: 130,
      render: (_value, record, index) => (
        <InputNumber
          value={record.quantity || undefined}
          min={1}
          controls={false}
          style={{ width: '100%' }}
          onChange={(value) => updateInputLine(index, { quantity: Number(value || 0) })}
        />
      ),
    },
    {
      title: 'Ghi chú',
      render: (_value, record, index) => (
        <Input
          value={record.note || ''}
          placeholder="Ghi chú nếu có"
          onChange={(event) => updateInputLine(index, { note: event.target.value })}
        />
      ),
    },
    {
      title: '',
      width: 56,
      render: (_value, _record, index) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeInputLine(index)}
          disabled={inputLines.length <= 1}
        />
      ),
    },
  ];

  const purchaseColumns: ColumnsType<PaperOptimizerPurchaseSpecRow> = [
    { title: 'Khổ mua', dataIndex: 'raw_width_cm', width: 110, render: (value) => formatFlexibleNumber(value, 2) },
    { title: 'Dài mua', dataIndex: 'run_length_cm', width: 110, render: (value) => formatFlexibleNumber(value, 2) },
    { title: 'Khổ hữu dụng', dataIndex: 'useful_width_cm', width: 120, render: (value) => formatFlexibleNumber(value, 2) },
    { title: 'Tổng số bộ mua thật', dataIndex: 'total_sets_purchase_spec', width: 160, render: (value) => formatNumber(value) },
    { title: 'Tổng chiều dài', dataIndex: 'total_length_cm_purchase_spec', width: 140, render: (value) => formatFlexibleNumber(value, 2) },
    {
      title: 'Đạt NCC',
      dataIndex: 'supplier_min_length_passed',
      width: 110,
      render: (value) => <Tag color={value ? 'green' : 'red'}>{value ? 'Đạt' : 'Chưa đạt'}</Tag>,
    },
    {
      title: 'Các dòng gốc',
      dataIndex: 'source_line_ids',
      render: (value) => (Array.isArray(value) && value.length ? value.join(', ') : '-'),
    },
  ];

  const compareColumns: ColumnsType<PaperOptimizerPlan> = [
    { title: 'Phương án', dataIndex: 'plan_name', width: 200 },
    { title: 'Scenario', dataIndex: 'scenario_code', width: 110 },
    { title: 'Tổng chi phí', dataIndex: 'total_converted_cost', width: 140, render: (value) => formatFlexibleNumber(value, 8) },
    { title: 'Tổng diện tích mua', dataIndex: 'total_purchase_area', width: 150, render: (value) => formatFlexibleNumber(value, 2) },
    { title: 'Số khổ giấy', dataIndex: 'unique_raw_width_count', width: 120, render: (value) => formatNumber(value) },
    { title: 'Số quy cách', dataIndex: 'unique_purchase_spec_count', width: 120, render: (value) => formatNumber(value) },
    { title: 'Số nhóm', dataIndex: 'final_group_count', width: 100, render: (value) => formatNumber(value) },
    { title: 'Hao hụt kỹ thuật', dataIndex: 'technical_waste_rate', width: 140, render: (value) => formatRate(value) },
    { title: 'Mã hội tụ', dataIndex: 'public_plan_convergence_reason_code', width: 180 },
    { title: 'Ghi chú', dataIndex: 'public_plan_selection_note' },
  ];

  const allocationColumns: ColumnsType<PaperOptimizerAllocationDetail> = [
    { title: 'Dòng gốc', dataIndex: 'line_id', width: 120 },
    { title: 'Nhu cầu gốc', dataIndex: 'base_quantity', width: 120, render: (value) => formatNumber(value) },
    { title: 'Dự trù SX', dataIndex: 'reserve_quantity', width: 110, render: (value) => formatNumber(value) },
    { title: 'Nhu cầu mục tiêu', dataIndex: 'target_quantity', width: 130, render: (value) => formatNumber(value) },
    { title: 'Số bộ dòng này', dataIndex: 'line_allocated_sets', width: 130, render: (value) => formatNumber(value) },
    { title: 'Dư kinh tế', dataIndex: 'economic_overproduction_quantity', width: 120, render: (value) => formatNumber(value) },
    { title: 'Khổ giấy', dataIndex: 'raw_width_cm', width: 100, render: (value) => formatFlexibleNumber(value, 2) },
    { title: 'Dài mua', dataIndex: 'run_length_cm', width: 110, render: (value) => formatFlexibleNumber(value, 2) },
    { title: 'Thiếu', dataIndex: 'missing_quantity', width: 90, render: (value) => formatNumber(value) },
  ];

  const reverseColumns: ColumnsType<PaperOptimizerReverseCheckRow> = [
    { title: 'Khổ giấy', dataIndex: 'raw_width_cm', width: 100, render: (value) => formatFlexibleNumber(value, 2) },
    { title: 'Dài mua', dataIndex: 'run_length_cm', width: 110, render: (value) => formatFlexibleNumber(value, 2) },
    { title: 'Tổng bộ tham chiếu', dataIndex: 'sum_line_allocated_sets', width: 140, render: (value) => formatNumber(value) },
    { title: 'Tổng bộ spec', dataIndex: 'total_sets_purchase_spec', width: 120, render: (value) => formatNumber(value) },
    { title: 'Tổng dài ngược', dataIndex: 'reverse_total_length_cm', width: 130, render: (value) => formatFlexibleNumber(value, 2) },
    { title: 'Tổng dài spec', dataIndex: 'spec_total_length_cm', width: 120, render: (value) => formatFlexibleNumber(value, 2) },
    {
      title: 'Nhất quán',
      dataIndex: 'consistent',
      width: 100,
      render: (value) => <Tag color={value ? 'green' : 'red'}>{value ? 'Có' : 'Không'}</Tag>,
    },
  ];

  const rawWidthColumns: ColumnsType<PaperOptimizerRawWidthUsageRow> = [
    { title: 'Khổ giấy', dataIndex: 'raw_width_cm', width: 100, render: (value) => formatFlexibleNumber(value, 2) },
    { title: 'Số nhóm', dataIndex: 'group_count', width: 100, render: (value) => formatNumber(value) },
    { title: 'Số quy cách', dataIndex: 'purchase_spec_count', width: 120, render: (value) => formatNumber(value) },
    { title: 'Tổng chiều dài', dataIndex: 'total_length_cm', width: 130, render: (value) => formatFlexibleNumber(value, 2) },
    {
      title: 'Dùng một lần',
      dataIndex: 'used_once',
      width: 110,
      render: (value) => <Tag color={value ? 'gold' : 'default'}>{value ? 'Có' : 'Không'}</Tag>,
    },
  ];

  const disabledGenerate = optimizeMutation.isPending || inputLines.length === 0;
  const acceptedRows = previewReport?.summary.accepted_row_count || 0;
  const invalidRows = previewReport?.summary.invalid_row_count || 0;

  return (
    <div data-testid="paper-optimizer-root">
      <PageHeader
        title="Tối ưu ghép giấy"
        subtitle="Một bề mặt làm việc duy nhất để nhập nhu cầu, cấu hình NCC, sinh phương án và kiểm tra đúng bảng mua cuối theo tổng chi phí thấp nhất."
      />

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Card style={{ ...sectionCardStyle, background: `linear-gradient(135deg, ${paperTheme.surfaceHero} 0%, ${paperTheme.surfaceBase} 100%)` }}>
          <Row gutter={[10, 10]}>
            <Col xs={12} md={6}>
              <MetricCard label="Run hiện tại" value={currentRun?.code || 'Chưa sinh'} accent="primary" />
            </Col>
            <Col xs={12} md={6}>
              <MetricCard label="State" value={uiStateLabel} accent={uiState === 'success' ? 'success' : uiState === 'optimizing' ? 'primary' : uiState.includes('failed') || uiState.includes('no_feasible') ? 'warning' : 'neutral'} />
            </Col>
            <Col xs={12} md={6}>
              <MetricCard label="Phương án đang chọn" value={selectedPlanSummaryValue} />
            </Col>
            <Col xs={12} md={6}>
              <MetricCard label="Tổng chi phí" value={summaryTotalCostValue} />
            </Col>
          </Row>
        </Card>

        {previewReport ? (
          <Alert
            data-testid="paper-optimizer-preview-alert"
            type={previewReport.issues.length ? 'warning' : 'success'}
            showIcon
            closable
            onClose={() => setPreviewReport(null)}
            message={
              previewReport.issues.length
                ? `Preview có ${formatNumber(invalidRows)} dòng cần xem lại.`
                : `Preview đã sẵn sàng với ${formatNumber(acceptedRows)} dòng hợp lệ.`
            }
            description={(
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text>
                  Hợp lệ: {formatNumber(acceptedRows)} · Lỗi: {formatNumber(invalidRows)} · Bỏ qua rỗng: {formatNumber(previewReport.summary.skipped_empty_row_count)}
                </Text>
                {previewReport.issues.length ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {previewReport.issues.map((issue) => (
                      <div
                        key={`${issue.row_number}-${issue.code}`}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 12,
                          background: paperTheme.surfaceSubtle,
                          border: `1px solid ${theme.colors.borderLight}`,
                        }}
                      >
                        <Text strong>Dòng {issue.row_number}</Text>
                        <Text style={{ color: theme.colors.textSecondary }}> · {issue.code}</Text>
                        <div style={{ marginTop: 2 }}>{issue.message}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Space>
            )}
          />
        ) : null}

        {uiState === 'failed' ? (
          <Alert
            type="error"
            showIcon
            message={`Run ${currentRun?.code || ''} thất bại`}
            description={
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text>{currentRun?.failed_reason || 'Engine chưa trả về phương án hợp lệ cho lần chạy này.'}</Text>
                <Space wrap data-testid="paper-optimizer-failed-actions">
                  <Button onClick={() => scrollToRef(inputSectionRef)}>Xem dữ liệu hiện tại</Button>
                  <Button onClick={() => scrollToRef(configSectionRef)}>Chỉnh cấu hình</Button>
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    loading={optimizeMutation.isPending}
                    onClick={handleFailedRerun}
                  >
                    Chạy lại
                  </Button>
                </Space>
              </Space>
            }
          />
        ) : null}

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={10}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div ref={inputSectionRef}>
                <SectionCard
                  step="Bước 1"
                  title="Dữ liệu đầu vào"
                  description="Nhập trực tiếp hoặc tải file preview. Invalid row chỉ hiển thị ở panel cảnh báo và không đi vào editor."
                  extra={(
                    <Space wrap>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        style={{ display: 'none' }}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void handleUploadFile(file);
                          }
                        }}
                      />
                      <Button icon={<UploadOutlined />} loading={uploadPreviewMutation.isPending} onClick={() => fileInputRef.current?.click()}>
                        Tải file preview
                      </Button>
                      <Button data-testid="paper-optimizer-download-import-template" icon={<DownloadOutlined />} onClick={() => void handleDownloadImportTemplate()}>
                        Tải mẫu nhập liệu
                      </Button>
                    </Space>
                  )}
                >
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Input
                      value={sourceFilename}
                      placeholder="Tên file nguồn nếu có"
                      onChange={(event) => {
                        initializedRef.current = true;
                        setSourceFilename(event.target.value);
                      }}
                    />
                    <Input.TextArea
                      value={note}
                      rows={2}
                      placeholder="Ghi chú cho lần chạy hiện tại"
                      onChange={(event) => {
                        initializedRef.current = true;
                        setNote(event.target.value);
                      }}
                    />
                    <Table
                      rowKey={(record, index) => `${record.id || index}-${index}`}
                      columns={inputColumns}
                      dataSource={inputLines}
                      pagination={false}
                      size="small"
                      scroll={{ x: 860 }}
                      locale={{ emptyText: 'Chưa có dòng nhu cầu nào. Hãy thêm tay hoặc tải file preview.' }}
                      className="enterprise-data-table"
                    />
                    <Space wrap>
                      <Button icon={<PlusOutlined />} onClick={addInputLine}>
                        Thêm dòng
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={handleResetDefaults}>
                        Khôi phục cấu hình mặc định
                      </Button>
                    </Space>
                  </Space>
                </SectionCard>
              </div>

              <div ref={configSectionRef}>
                <SectionCard
                  step="Bước 2"
                  title="Cấu hình NCC"
                  description="Mỗi quy cách mua cuối phải tự đạt NCC. Khổ giấy thô chỉ được bật/tắt trong tập 110..280, bước 5."
                >
                  <Row gutter={[8, 8]}>
                    <Col xs={24} md={12}>
                      <Text strong>Tổng chiều dài tối thiểu mỗi quy cách</Text>
                      <InputNumber
                        data-testid="paper-optimizer-min-purchase-length"
                        value={supplierConfig.min_purchase_length_cm ?? undefined}
                        min={MIN_PURCHASE_LENGTH_STANDARD_CM}
                        controls={false}
                        style={{ width: '100%', marginTop: 4 }}
                        onChange={(value) => updateSupplierConfig({ min_purchase_length_cm: Number(value || MIN_PURCHASE_LENGTH_STANDARD_CM) })}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Text strong>Tề biên</Text>
                      <InputNumber
                        value={supplierConfig.trim_edge_cm ?? undefined}
                        min={0}
                        controls={false}
                        style={{ width: '100%', marginTop: 4 }}
                        onChange={(value) => updateSupplierConfig({ trim_edge_cm: Number(value || 0) })}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Text strong>Khổ ghép tối đa</Text>
                      <InputNumber
                        value={supplierConfig.max_combination_width_cm ?? undefined}
                        min={0}
                        controls={false}
                        style={{ width: '100%', marginTop: 4 }}
                        onChange={(value) => updateSupplierConfig({ max_combination_width_cm: Number(value || 0) })}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Text strong>Dài ghép tối đa</Text>
                      <InputNumber
                        value={supplierConfig.max_combined_length_cm ?? undefined}
                        min={0}
                        controls={false}
                        style={{ width: '100%', marginTop: 4 }}
                        onChange={(value) => updateSupplierConfig({ max_combined_length_cm: value == null ? null : Number(value) })}
                      />
                    </Col>
                    <Col span={24}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <Space wrap size={6}>
                          <Text strong>Khổ giấy thô khả dụng</Text>
                          <Tag color="blue" data-testid="paper-optimizer-raw-width-summary">
                            Đã bật {selectedRawWidths.length}/{RAW_WIDTH_OPTIONS.length} khổ
                          </Tag>
                        </Space>
                        <Space wrap size={6}>
                          <Button size="small" onClick={handleUseAllRawWidths}>
                            Tất cả
                          </Button>
                          <Button size="small" onClick={handleUseRecommendedRawWidths}>
                            Chuẩn NCC
                          </Button>
                          <Button size="small" onClick={handleClearRawWidths}>
                            Bỏ chọn hết
                          </Button>
                          <Button
                            data-testid="paper-optimizer-raw-width-toggle"
                            size="small"
                            type="text"
                            onClick={() => setRawWidthExpanded((current) => !current)}
                          >
                            {rawWidthExpanded ? 'Thu gọn' : 'Mở rộng'}
                          </Button>
                        </Space>
                      </div>
                      <div
                        data-testid="paper-optimizer-raw-width-panel"
                        style={{
                          marginTop: 8,
                          padding: 10,
                          borderRadius: 14,
                          border: `1px solid ${theme.colors.borderLight}`,
                          background: paperTheme.surfaceSubtle,
                          maxHeight: rawWidthExpanded ? 'none' : RAW_WIDTH_COLLAPSED_MAX_HEIGHT,
                          overflow: 'hidden',
                        }}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {RAW_WIDTH_OPTIONS.map((option) => (
                            <Tag.CheckableTag
                              key={option}
                              checked={selectedRawWidths.includes(option)}
                              onChange={() => handleToggleRawWidth(option)}
                            >
                              {option}
                            </Tag.CheckableTag>
                          ))}
                        </div>
                      </div>
                      <Text style={{ display: 'block', marginTop: 6, color: theme.colors.textSecondary }}>
                        Tập chuẩn cố định 110..280, bước 5. Mỗi quy cách mua cuối vẫn phải đạt tối thiểu {formatNumber(MIN_PURCHASE_LENGTH_STANDARD_CM)} cm/spec.
                      </Text>
                    </Col>
                  </Row>
                </SectionCard>
              </div>

              <SectionCard
                step="Bước 3"
                title="Dự trù, dư kinh tế và chi phí"
                description="Nhu cầu gốc -> Dự trù hao hụt sản xuất -> Nhu cầu mục tiêu; sau đó engine mới được phép tạo dư kinh tế nếu tổng chi phí thấp hơn."
              >
                <Row gutter={[10, 10]}>
                  <Col xs={24} md={12}>
                    <Text strong>Tỷ lệ dự trù hao hụt (%)</Text>
                    <InputNumber
                      value={optimizationConfig.production_reserve_rate_percent ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ production_reserve_rate_percent: Number(value || 0) })}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <Text strong>Cách làm tròn</Text>
                    <Tabs
                      size="small"
                      activeKey={optimizationConfig.production_reserve_rounding_mode || 'ceil'}
                      items={[
                        { key: 'ceil', label: 'Làm tròn lên' },
                        { key: 'round', label: 'Làm tròn chuẩn' },
                        { key: 'floor', label: 'Làm tròn xuống' },
                      ]}
                      onChange={(value) => updateOptimizationConfig({ production_reserve_rounding_mode: value as 'ceil' | 'round' | 'floor' })}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <Text strong>Bật dư kinh tế</Text>
                    <Checkbox
                      checked={Boolean(optimizationConfig.allow_economic_overproduction)}
                      onChange={(event) => updateOptimizationConfig({ allow_economic_overproduction: event.target.checked })}
                    >
                      Cho phép engine tự tạo dư kinh tế
                    </Checkbox>
                  </Col>
                  <Col xs={24} md={12}>
                    <Text strong>Cho phép vượt nhu cầu mục tiêu</Text>
                    <Checkbox
                      checked={Boolean(optimizationConfig.allow_exceed_target_demand)}
                      onChange={(event) => updateOptimizationConfig({ allow_exceed_target_demand: event.target.checked })}
                    >
                      Bật vượt nhu cầu mục tiêu
                    </Checkbox>
                  </Col>
                  <Col xs={12} md={6}>
                    <Text strong>% dư tối đa toàn đơn</Text>
                    <InputNumber
                      value={optimizationConfig.max_economic_overproduction_rate_percent_total ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ max_economic_overproduction_rate_percent_total: value == null ? null : Number(value) })}
                    />
                  </Col>
                  <Col xs={12} md={6}>
                    <Text strong>SL dư tối đa toàn đơn</Text>
                    <InputNumber
                      value={optimizationConfig.max_economic_overproduction_quantity_total ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ max_economic_overproduction_quantity_total: value == null ? null : Number(value) })}
                    />
                  </Col>
                  <Col xs={12} md={6}>
                    <Text strong>% dư tối đa mỗi dòng</Text>
                    <InputNumber
                      value={optimizationConfig.max_economic_overproduction_rate_percent_per_line ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ max_economic_overproduction_rate_percent_per_line: value == null ? null : Number(value) })}
                    />
                  </Col>
                  <Col xs={12} md={6}>
                    <Text strong>SL dư tối đa mỗi dòng</Text>
                    <InputNumber
                      value={optimizationConfig.max_economic_overproduction_quantity_per_line ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ max_economic_overproduction_quantity_per_line: value == null ? null : Number(value) })}
                    />
                  </Col>
                  <Col xs={12} md={8}>
                    <Text strong>Trọng số hao hụt kỹ thuật</Text>
                    <InputNumber
                      value={optimizationConfig.technical_waste_cost_weight ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ technical_waste_cost_weight: Number(value || 0) })}
                    />
                  </Col>
                  <Col xs={12} md={8}>
                    <Text strong>Trọng số dư kinh tế</Text>
                    <InputNumber
                      value={optimizationConfig.economic_overproduction_cost_weight ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ economic_overproduction_cost_weight: Number(value || 0) })}
                    />
                  </Col>
                  <Col xs={12} md={8}>
                    <Text strong>Trọng số khổ giấy mới</Text>
                    <InputNumber
                      value={optimizationConfig.new_raw_width_cost_weight ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ new_raw_width_cost_weight: Number(value || 0) })}
                    />
                  </Col>
                  <Col xs={12} md={8}>
                    <Text strong>Trọng số quy cách mới</Text>
                    <InputNumber
                      value={optimizationConfig.new_purchase_spec_cost_weight ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ new_purchase_spec_cost_weight: Number(value || 0) })}
                    />
                  </Col>
                  <Col xs={12} md={8}>
                    <Text strong>Trọng số phân mảnh</Text>
                    <InputNumber
                      value={optimizationConfig.fragmentation_cost_weight ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ fragmentation_cost_weight: Number(value || 0) })}
                    />
                  </Col>
                  <Col xs={12} md={8}>
                    <Text strong>Tăng chi phí chấp nhận để giảm khổ (%)</Text>
                    <InputNumber
                      value={optimizationConfig.acceptable_cost_increase_for_fewer_raw_widths_percent ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ acceptable_cost_increase_for_fewer_raw_widths_percent: Number(value || 0) })}
                    />
                  </Col>
                  <Col xs={12} md={8}>
                    <Text strong>Tăng chi phí chấp nhận để giảm quy cách (%)</Text>
                    <InputNumber
                      value={optimizationConfig.acceptable_cost_increase_for_fewer_specs_percent ?? undefined}
                      min={0}
                      controls={false}
                      style={{ width: '100%', marginTop: 4 }}
                      onChange={(value) => updateOptimizationConfig({ acceptable_cost_increase_for_fewer_specs_percent: Number(value || 0) })}
                    />
                  </Col>
                </Row>
              </SectionCard>
            </Space>
          </Col>

          <Col xs={24} xl={14}>
            <div
              ref={resultSectionRef}
              tabIndex={-1}
              data-testid="paper-optimizer-result-section"
              style={{
                outline: 'none',
                borderRadius: 22,
                transition: 'box-shadow 180ms ease, transform 180ms ease',
                boxShadow: resultSpotlightActive ? `0 0 0 3px ${paperTheme.primaryBorder}` : 'none',
                transform: resultSpotlightActive ? 'translateY(-2px)' : 'translateY(0)',
              }}
            >
            <SectionCard
              step="Bước 4"
              title="Kết quả hiện tại"
              description="Chỉ giữ đúng một kết quả hiện tại để so sánh và xuất Excel, tránh nhầm giữa nhiều lần chạy."
              extra={(
                <Space wrap>
                  <Button
                    data-testid="paper-optimizer-generate"
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    loading={optimizeMutation.isPending}
                    disabled={disabledGenerate}
                    onClick={handleGenerate}
                  >
                    Sinh phương án
                  </Button>
                  <Button
                    data-testid="paper-optimizer-export"
                    icon={<DownloadOutlined />}
                    onClick={() => void handleExportExcel()}
                    loading={exporting}
                    disabled={!canExportCurrentRun}
                  >
                    Tải Excel
                  </Button>
                </Space>
              )}
            >
              {uiState === 'optimizing' ? (
                <div
                  data-testid="paper-optimizer-result-loading"
                  style={{
                    minHeight: 220,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 18,
                    border: `1px dashed ${paperTheme.primaryBorder}`,
                    background: paperTheme.primarySoft,
                    padding: 20,
                  }}
                >
                  <Space direction="vertical" size={12} align="center">
                    <Spin size="large" />
                    <Text strong>Đang sinh phương án...</Text>
                    <Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>
                      Kết quả mới sẽ thay thế kết quả cũ ngay trên màn này và tự đưa bạn đến bảng Phương án cuối.
                    </Text>
                  </Space>
                </div>
              ) : !currentRun ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    uiState === 'blank'
                      ? 'Chưa có dữ liệu để chạy. Hãy nhập nhu cầu hoặc tải file preview.'
                      : 'Dữ liệu đã sẵn sàng. Hãy bấm Sinh phương án để tạo đúng một kết quả hiện tại.'
                  }
                />
              ) : currentRun.status === 'FAILED' ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Run hiện tại đang ở trạng thái thất bại. Hãy xem cảnh báo phía trên để chỉnh lại dữ liệu hoặc cấu hình."
                />
              ) : (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  {isNoFeasibleResult ? (
                    <>
                      <Alert
                        data-testid="paper-optimizer-result-no-feasible"
                        type="warning"
                        showIcon
                        message={`Run ${currentRun.code} chưa tìm được phương án mua cuối hợp lệ`}
                        description={(
                          <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <Text>
                              {failedPurchaseSpecCount > 0
                                ? `Hiện có ${formatNumber(failedPurchaseSpecCount)} quy cách chưa đạt tối thiểu ${formatNumber(MIN_PURCHASE_LENGTH_STANDARD_CM)} cm/spec hoặc không còn candidate nào vừa đạt NCC vừa giữ được cấu hình chi phí hiện tại.`
                                : `Chưa tìm được phương án vừa đạt NCC ${formatNumber(MIN_PURCHASE_LENGTH_STANDARD_CM)} cm/spec vừa phù hợp cấu hình hiện tại.`}
                            </Text>
                            <Text style={{ color: theme.colors.textSecondary }}>
                              Candidate: {formatNumber(stats.candidate_count)} · Feasible: {formatNumber(stats.feasible_alternative_count)} · Lý do engine: {stats.engine_fallback_reason_code || 'Không có'}
                            </Text>
                            {selectedPlan?.public_plan_selection_note ? (
                              <Text style={{ color: theme.colors.textSecondary }}>
                                {selectedPlan.public_plan_selection_note}
                              </Text>
                            ) : null}
                            <Space wrap>
                              <Button onClick={() => scrollToRef(configSectionRef)}>Chỉnh cấu hình</Button>
                              <Button onClick={handleResetDefaults}>Khôi phục mặc định</Button>
                              <Button onClick={() => setNoFeasibleDebugOpen(true)}>Xem debug</Button>
                              <Button
                                type="primary"
                                icon={<PlayCircleOutlined />}
                                loading={optimizeMutation.isPending}
                                onClick={handleGenerate}
                              >
                                Chạy lại
                              </Button>
                            </Space>
                          </Space>
                        )}
                      />
                      <Collapse
                        size="small"
                        activeKey={noFeasibleDebugOpen ? ['no-feasible-debug'] : []}
                        onChange={(keys) => setNoFeasibleDebugOpen(Array.isArray(keys) ? keys.includes('no-feasible-debug') : keys === 'no-feasible-debug')}
                        items={[
                          {
                            key: 'no-feasible-debug',
                            label: 'Debug',
                            children: (
                              <Table
                                data-testid="paper-optimizer-no-feasible-debug"
                                rowKey="label"
                                pagination={false}
                                size="small"
                                dataSource={[
                                  { label: 'Plan code', value: activePayload?.selected_plan_code || '-' },
                                  { label: 'Scenario', value: activePayload?.selected_scenario_code || '-' },
                                  { label: 'Convergence code', value: selectedPlan?.public_plan_convergence_reason_code || '-' },
                                  { label: 'Convergence note', value: selectedPlan?.public_plan_selection_note || '-' },
                                  { label: 'Candidate count', value: formatNumber(stats.candidate_count) },
                                  { label: 'Feasible alternative count', value: formatNumber(stats.feasible_alternative_count) },
                                  { label: 'Purchase spec NCC failed count', value: formatNumber(stats.purchase_spec_ncc_failed_count) },
                                ]}
                                columns={[
                                  { title: 'Chỉ tiêu', dataIndex: 'label', width: 220 },
                                  { title: 'Giá trị', dataIndex: 'value' },
                                ]}
                                className="enterprise-data-table"
                              />
                            ),
                          },
                        ]}
                      />
                    </>
                  ) : hasVisibleResultData ? (
                    <Alert
                      data-testid="paper-optimizer-result-ready"
                      type="success"
                      showIcon
                      message={`Đã cập nhật kết quả ${currentRun.code}`}
                      description="Bảng Phương án cuối bên dưới là kết quả hiện tại duy nhất của màn này và sẽ được dùng để tải Excel."
                    />
                  ) : successWithoutVisibleRows ? (
                    <Alert
                      data-testid="paper-optimizer-result-empty"
                      type="warning"
                      showIcon
                      message={`Run ${currentRun.code} đã hoàn tất nhưng chưa có dữ liệu mua cuối để hiển thị`}
                      description={(
                        <Space direction="vertical" size={10} style={{ width: '100%' }}>
                          <Text>
                            Engine đã trả về trạng thái thành công nhưng chưa có đủ dữ liệu để dựng bảng Phương án cuối.
                            Hãy kiểm tra cấu hình, mở tab Debug hoặc chạy lại để làm mới kết quả hiện tại.
                          </Text>
                          <Space wrap>
                            <Button onClick={() => scrollToRef(configSectionRef)}>Chỉnh cấu hình</Button>
                            <Button onClick={() => setResultTabKey('debug')}>Xem debug</Button>
                            <Button
                              type="primary"
                              icon={<PlayCircleOutlined />}
                              loading={optimizeMutation.isPending}
                              onClick={handleGenerate}
                            >
                              Chạy lại
                            </Button>
                          </Space>
                        </Space>
                      )}
                    />
                  ) : null}

                  {hasVisibleResultData ? (
                    <>
                      <Row gutter={[10, 10]}>
                        <Col xs={12} md={6}>
                          <MetricCard label="Nhu cầu mục tiêu" value={formatNumber(selectedPlan?.target_requested_quantity_total)} accent="primary" />
                        </Col>
                        <Col xs={12} md={6}>
                          <MetricCard label="Dư kinh tế" value={formatNumber(selectedPlan?.economic_overproduction_quantity_total)} accent={Number(selectedPlan?.economic_overproduction_quantity_total || 0) > 0 ? 'warning' : 'neutral'} />
                        </Col>
                        <Col xs={12} md={6}>
                          <MetricCard label="Số khổ giấy" value={formatNumber(selectedPlan?.unique_raw_width_count)} />
                        </Col>
                        <Col xs={12} md={6}>
                          <MetricCard label="Số quy cách" value={formatNumber(selectedPlan?.unique_purchase_spec_count)} />
                        </Col>
                      </Row>

                      <Tabs
                        data-testid="paper-optimizer-result-tabs"
                        activeKey={resultTabKey}
                        onChange={setResultTabKey}
                        items={[
                          {
                            key: 'purchase',
                            label: 'Phương án cuối',
                            children: (
                              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                <Table
                                  data-testid="paper-optimizer-purchase-spec-table"
                                  rowKey={(record) => record.group_id || `${record.raw_width_cm}-${record.run_length_cm}`}
                                  columns={purchaseColumns}
                                  dataSource={purchaseSpecRows}
                                  pagination={false}
                                  size="small"
                                  scroll={{ x: 960 }}
                                  locale={{ emptyText: 'Chưa có quy cách mua cuối để hiển thị.' }}
                                  className="enterprise-data-table"
                                />
                                {leftovers.length ? (
                                  <Alert
                                    type="warning"
                                    showIcon
                                    message="Còn dòng chưa phân bổ"
                                    description={`${formatNumber(leftovers.length)} dòng vẫn chưa được phân bổ đủ trong kết quả hiện tại.`}
                                  />
                                ) : (
                                  <Alert type="success" showIcon message="Không còn dòng chưa phân bổ trong kết quả hiện tại." />
                                )}
                              </Space>
                            ),
                          },
                          {
                            key: 'compare',
                            label: 'So sánh 4 phương án',
                            children: (
                              <Table
                                rowKey={(record) => record.plan_code}
                                columns={compareColumns}
                                dataSource={comparePlans}
                                pagination={false}
                                size="small"
                                scroll={{ x: 1160 }}
                                className="enterprise-data-table"
                              />
                            ),
                          },
                          {
                            key: 'details',
                            label: 'Chi tiết',
                            children: (
                              <Collapse
                                size="small"
                                items={[
                                  {
                                    key: 'allocation',
                                    label: 'Chi tiết phân bổ',
                                    children: (
                                      <Table
                                        rowKey={(record, index) => `${record.line_id || index}-${index}`}
                                        columns={allocationColumns}
                                        dataSource={allocationRows}
                                        pagination={false}
                                        size="small"
                                        scroll={{ x: 1020 }}
                                        className="enterprise-data-table"
                                      />
                                    ),
                                  },
                                  {
                                    key: 'reverse',
                                    label: 'Kiểm tra phân bổ ngược',
                                    children: (
                                      <Table
                                        rowKey={(record) => `${record.raw_width_cm}-${record.run_length_cm}`}
                                        columns={reverseColumns}
                                        dataSource={reverseRows}
                                        pagination={false}
                                        size="small"
                                        scroll={{ x: 1000 }}
                                        className="enterprise-data-table"
                                      />
                                    ),
                                  },
                                  {
                                    key: 'width-summary',
                                    label: 'Thống kê khổ giấy',
                                    children: (
                                      <Table
                                        rowKey={(record) => `${record.raw_width_cm}`}
                                        columns={rawWidthColumns}
                                        dataSource={rawWidthRows}
                                        pagination={false}
                                        size="small"
                                        className="enterprise-data-table"
                                      />
                                    ),
                                  },
                                ]}
                              />
                            ),
                          },
                          {
                            key: 'debug',
                            label: 'Debug',
                            children: (
                              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                <Alert
                                  type={stats.engine_fallback_used ? 'warning' : 'info'}
                                  showIcon
                                  message={stats.engine_fallback_used ? 'Run hiện tại có fallback engine' : 'Thông tin debug của run hiện tại'}
                                  description={`Engine chính: ${stats.engine_primary || '-'} · Fallback: ${stats.engine_fallback_used ? (stats.engine_fallback_source || 'legacy') : 'Không'}${stats.engine_fallback_reason_code ? ` · Lý do: ${stats.engine_fallback_reason_code}` : ''}`}
                                />
                                <Table
                                  rowKey="label"
                                  pagination={false}
                                  size="small"
                                  dataSource={[
                                    { label: 'Plan code', value: activePayload?.selected_plan_code || '-' },
                                    { label: 'Scenario', value: activePayload?.selected_scenario_code || '-' },
                                    { label: 'Convergence code', value: selectedPlan?.public_plan_convergence_reason_code || '-' },
                                    { label: 'Convergence note', value: selectedPlan?.public_plan_selection_note || '-' },
                                    { label: 'Candidate count', value: formatNumber(stats.candidate_count) },
                                    { label: 'Feasible alternative count', value: formatNumber(stats.feasible_alternative_count) },
                                    { label: 'Purchase spec NCC failed count', value: formatNumber(stats.purchase_spec_ncc_failed_count) },
                                  ]}
                                  columns={[
                                    { title: 'Chỉ tiêu', dataIndex: 'label', width: 220 },
                                    { title: 'Giá trị', dataIndex: 'value' },
                                  ]}
                                  className="enterprise-data-table"
                                />
                              </Space>
                            ),
                          },
                        ]}
                      />
                    </>
                  ) : successWithoutVisibleRows ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="Run hiện tại đã hoàn tất nhưng chưa có dữ liệu đủ để dựng bảng Phương án cuối. Hãy xem debug hoặc chạy lại sau khi chỉnh cấu hình."
                    />
                  ) : null}
                </Space>
              )}
            </SectionCard>
            </div>
          </Col>
        </Row>
      </Space>
    </div>
  );
}
