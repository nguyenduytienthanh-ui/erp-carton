import { useState } from 'react';
import { Modal, Upload, Button, message, Alert, Checkbox } from 'antd';
import { InboxOutlined, DownloadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { theme } from '../../styles/theme';

interface ImportErrorItem {
  row?: number;
  error?: string;
}

interface ImportResult {
  success_count: number;
  error_count: number;
  errors?: Array<ImportErrorItem | string>;
}

interface ApiErrorShape {
  response?: {
    data?: {
      error?: string;
      detail?: string;
      errors?: ImportErrorItem[];
    };
  };
}

interface ImportModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onDownloadTemplate: () => void;
  onImport: (file: File, options?: { updateIfExists?: boolean }) => Promise<ImportResult>;
  entityName?: string;
}


const ImportModal = ({
  visible,
  onClose,
  onSuccess,
  onDownloadTemplate,
  onImport,
  entityName = 'sản phẩm',
}: ImportModalProps) => {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [updateIfExists, setUpdateIfExists] = useState(false);

  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls',
    beforeUpload: (file) => {
      const isExcel =
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.type === 'application/vnd.ms-excel';
      if (!isExcel) {
        message.error('Chỉ chấp nhận file Excel (.xlsx, .xls)!');
        return false;
      }

      const isLt10M = file.size / 1024 / 1024 < 10;
      if (!isLt10M) {
        message.error('File phải nhỏ hơn 10MB!');
        return false;
      }

      setFile(file);
      return false; // Prevent auto upload
    },
    onRemove: () => {
      setFile(null);
      setResult(null);
    },
    fileList: file
      ? [{
          uid: '-1',
          name: file.name,
          status: 'done',
          size: file.size,
          type: file.type,
        }]
      : [],
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    onClose();
  };

  const handleImport = async () => {
    if (!file) {
      message.warning('Vui lòng chọn file!');
      return;
    }

    setUploading(true);
    try {
      const result = await onImport(file, { updateIfExists });
      setResult(result);

      if (result.error_count === 0) {
        message.success(`Import thành công ${result.success_count} ${entityName}!`);
        setTimeout(() => {
          onSuccess();
          handleClose();
        }, 1500);
      } else {
        message.warning({
          content: `Import hoàn tất: ${result.success_count} thành công, ${result.error_count} lỗi. Xem chi tiết bên dưới.`,
          duration: 5,
        });
        onSuccess();
      }
    } catch (error: unknown) {
      const typedError = error as ApiErrorShape;
      const data = typedError.response?.data;
      let errMsg = 'Import thất bại!';
      if (data) {
        if (typeof data.error === 'string') errMsg = data.error;
        else if (typeof data.detail === 'string') errMsg = data.detail;
        else if (Array.isArray(data.errors) && data.errors.length > 0) {
          errMsg = data.errors.map((e: ImportErrorItem) =>
            e.row ? `Dòng ${e.row}: ${e.error || ''}` : e.error
          ).slice(0, 5).join('; ') + (data.errors.length > 5 ? ` ... (+${data.errors.length - 5} lỗi)` : '');
        }
      }
      message.error(errMsg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      title={`Import ${entityName} từ Excel`}
      open={visible}
      onCancel={handleClose}
      width={700}
      footer={[
        <Button key="template" icon={<DownloadOutlined />} onClick={onDownloadTemplate}>
          Tải Template
        </Button>,
        <Button key="cancel" onClick={handleClose}>
          Đóng
        </Button>,
        <Button
          key="import"
          type="primary"
          loading={uploading}
          onClick={handleImport}
          disabled={!file}
        >
          Import
        </Button>,
      ]}
    >
      <Alert
        message="Hướng dẫn"
        description={
          <div>
            <p>1. <strong>Tải xuống</strong> file mẫu (nút &quot;Tải Template&quot;) rồi điền dữ liệu vào Excel.</p>
            <p>2. <strong>Bắt buộc</strong>: Tên hàng, Mã đơn vị (phải tồn tại trong hệ thống). Mã hàng trùng: báo lỗi hoặc cập nhật (nếu chọn bên dưới).</p>
            <p>3. <strong>Tải lên</strong>: kéo thả file vào vùng bên dưới hoặc bấm để chọn file.</p>
            <p>4. Sau khi chọn file, bấm nút <strong>&quot;Import&quot;</strong> để nhập dữ liệu.</p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: theme.spacing.md }}
      />

      <div style={{ marginBottom: theme.spacing.md }}>
        <Checkbox
          checked={updateIfExists}
          onChange={(e) => setUpdateIfExists(e.target.checked)}
        >
          Cập nhật sản phẩm nếu mã đã tồn tại (nếu không chọn: báo lỗi khi mã trùng)
        </Checkbox>
      </div>

      <Upload.Dragger {...uploadProps}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click hoặc kéo file vào đây để upload</p>
        <p className="ant-upload-hint">Hỗ trợ file .xlsx, .xls (tối đa 10MB)</p>
      </Upload.Dragger>

      {result && (
        <div style={{ marginTop: theme.spacing.lg }}>
          <Alert
            message="Kết quả import"
            description={
              <div>
                <p>✅ Thành công: {result.success_count}</p>
                <p>❌ Lỗi: {result.error_count}</p>
                {result.errors && result.errors.length > 0 && (
                  <div style={{ marginTop: theme.spacing.sm }}>
                    <p>
                      <strong>Chi tiết lỗi:</strong>
                    </p>
                    <ul style={{ maxHeight: '200px', overflow: 'auto', paddingLeft: 20 }}>
                      {result.errors.map((err: ImportErrorItem | string, index: number) => {
                        const msg = typeof err === 'object' && err !== null
                          ? (err.row ? `Dòng ${err.row}: ${err.error || ''}` : String(err.error || ''))
                          : String(err);
                        return <li key={index}>{msg}</li>;
                      })}
                    </ul>
                  </div>
                )}
              </div>
            }
            type={result.error_count > 0 ? 'warning' : 'success'}
            showIcon
          />
        </div>
      )}
    </Modal>
  );
};

export default ImportModal;
