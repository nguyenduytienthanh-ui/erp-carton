import { Empty } from 'antd';

export default function ShipmentList() {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <Empty description="Chức năng Phiếu xuất (Giao hàng) chưa được triển khai" />
      <p style={{ marginTop: 16, color: '#666' }}>
        Trang này sẽ hiển thị danh sách các phiếu giao hàng/xuất kho.
      </p>
    </div>
  );
}
