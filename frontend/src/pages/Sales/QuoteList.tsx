import { Empty } from 'antd';

export default function QuoteList() {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <Empty description="Chức năng Báo giá chưa được triển khai" />
      <p style={{ marginTop: 16, color: '#666' }}>
        Trang này sẽ hiển thị danh sách các báo giá từ khách hàng.
      </p>
    </div>
  );
}
