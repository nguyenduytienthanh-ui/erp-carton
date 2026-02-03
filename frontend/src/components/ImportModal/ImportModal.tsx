import { useState } from 'react';
import { Modal, Upload, Button, message, Alert } from 'antd';
import { InboxOutlined, DownloadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { theme } from '../../styles/theme';

interface ImportModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onDownloadTemplate: () => void;
  onImport: (file: File) => Promise<any>;
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
  const [result, setResult] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);

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
    fileList: file ? [file as any] : [],
  };

  const handleImport = async () => {
    if (!file) {
      message.warning('Vui lòng chọn file!');
      return;
    }

    setUploading(true);
    try {
      const result = await onImport(file);
      setResult(result);

      if (result.error_count === 0) {
        message.success(`Import thành công ${result.success_count} ${entityName}!`);
        setTimeout(() => {
          onSuccess();
          handleClose();
        }, 1500);
      } else {
        message.warning(`Import hoàn tất với ${result.error_count} lỗi!`);
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || 'Import thất bại!');
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    onClose();
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
            <p>2. <strong>Tải lên</strong>: kéo thả file vào vùng bên dưới hoặc bấm để chọn file.</p>
            <p>3. Sau khi chọn file, bấm nút <strong>&quot;Import&quot;</strong> để nhập dữ liệu (không dùng nút Tải Template để import).</p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: theme.spacing.md }}
      />

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
                    <ul style={{ maxHeight: '200px', overflow: 'auto' }}>
                      {result.errors.map((error: string, index: number) => (
                        <li key={index}>{error}</li>
                      ))}
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
