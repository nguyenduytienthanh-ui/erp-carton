interface ModulePlaceholderProps {
  title: string;
  description: string;
}

export default function ModulePlaceholder({ title, description }: ModulePlaceholderProps) {
  return (
    <div style={{ padding: 20, border: '1px solid #f0f0f0', borderRadius: 10 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p style={{ marginBottom: 8, color: '#595959' }}>{description}</p>
      <p style={{ margin: 0, color: '#8c8c8c' }}>
        Module này đang được dựng theo chuẩn dữ liệu mới (API + permission + search toàn cột + quick entry).
      </p>
    </div>
  );
}

