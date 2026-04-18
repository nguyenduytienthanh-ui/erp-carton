import axiosInstance from './axios';
import type {
  PaperOptimizerDefaultsResponse,
  PaperOptimizerLine,
  PaperOptimizerManualPatternComponent,
  PaperOptimizerManualPatternResponse,
  PaperOptimizerOptimizationConfig,
  PaperOptimizerPreviewResponse,
  PaperOptimizerRun,
  PaperOptimizerSupplierConfig,
} from '../types/paperOptimizer';

const RUNS_BASE = '/production/paper-optimizer/runs/';

export const paperOptimizerApi = {
  getDefaults: async (): Promise<PaperOptimizerDefaultsResponse> => {
    const response = await axiosInstance.get(`${RUNS_BASE}defaults/`);
    return response.data as PaperOptimizerDefaultsResponse;
  },

  optimize: async (payload: {
    source_filename?: string;
    note?: string;
    input_lines: PaperOptimizerLine[];
    supplier_config: PaperOptimizerSupplierConfig;
    optimization_config: PaperOptimizerOptimizationConfig;
  }): Promise<PaperOptimizerRun> => {
    const response = await axiosInstance.post(`${RUNS_BASE}optimize/`, payload);
    return response.data as PaperOptimizerRun;
  },

  getRun: async (id: number): Promise<PaperOptimizerRun> => {
    const response = await axiosInstance.get(`${RUNS_BASE}${id}/`);
    return response.data as PaperOptimizerRun;
  },

  uploadPreview: async (file: File): Promise<PaperOptimizerPreviewResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await axiosInstance.post(`${RUNS_BASE}upload_preview/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data as PaperOptimizerPreviewResponse;
  },

  evaluateManualPattern: async (payload: {
    raw_width_cm: number;
    trim_edge_cm?: number;
    run_length_cm: number;
    sets: number;
    components: PaperOptimizerManualPatternComponent[];
  }): Promise<PaperOptimizerManualPatternResponse> => {
    const response = await axiosInstance.post(`${RUNS_BASE}evaluate_manual_pattern/`, payload);
    return response.data as PaperOptimizerManualPatternResponse;
  },

  exportExcel: async (id: number): Promise<Blob> => {
    const response = await axiosInstance.get(`${RUNS_BASE}${id}/export_excel/`, {
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  downloadImportTemplate: async (): Promise<Blob> => {
    const response = await axiosInstance.get(`${RUNS_BASE}download_import_template/`, {
      responseType: 'blob',
    });
    return response.data as Blob;
  },
};
