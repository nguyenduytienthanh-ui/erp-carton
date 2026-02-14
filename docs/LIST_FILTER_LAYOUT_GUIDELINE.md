# List Filter Layout Guideline (BẮT BUỘC)

## Màn hình chuẩn tham chiếu
- ProductList là chuẩn gốc cho:
  - chiều cao khu filter
  - cách sắp xếp bộ lọc
  - trải nghiệm nhập / clear / reset

## Quy ước layout filter
- Filter nằm trong 1 container duy nhất (border rõ ràng).
- Filter sắp xếp theo hàng ngang, cho phép wrap xuống dòng.
- Các input filter có chiều cao đồng nhất.
- Khoảng cách giữa các filter đều nhau.
- Nút "Xóa bộ lọc" nằm cuối, dễ thấy.

## Quy ước hành vi
- Nhập liệu mượt, không bị giật.
- Filter số nhập liên tục.
- Có nút clear từng ô.
- Có nút "Xóa bộ lọc" tổng.

## Quy ước kỹ thuật
- Dùng hook `useSearchFilterIntent`.
- Input chỉ để nhập, không debounce.
- Intent mới gọi API.
- Không dùng allowClear của Ant Design.
- Dùng QuickClearIcon cho xóa nhanh.

## Áp dụng
- MỌI màn hình danh sách (công đoạn, khuôn, danh mục, đơn hàng...)
  phải làm GIỐNG ProductList.
- Không tự sáng tạo layout mới.

---

**Tham chiếu:** `.cursorrules` §4, ProductList (`frontend/src/pages/Products/ProductList.tsx`), docs/SEARCH_FILTER_GUIDELINE.md, docs/QUICK_CLEAR_ICON_USAGE.md.
