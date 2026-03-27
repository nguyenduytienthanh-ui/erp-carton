# Quy tắc dùng chung bắt buộc

## Mục tiêu

Tài liệu này chốt các quy tắc phải dùng chung trên toàn hệ thống để giao diện đồng nhất, hiện đại, dễ dùng và để AI không viết lại cùng một kiểu hành vi ở nhiều nơi.

## Nguyên tắc tổng quát

- Mặc định ưu tiên dùng lại pattern, hook, component và câu chữ đã có.
- Chỉ làm riêng khi sự khác biệt đến từ nghiệp vụ, không phải vì sở thích giao diện.
- Frontend chỉ là lớp hỗ trợ trải nghiệm; backend mới là nơi chốt dữ liệu và quyền hạn.

## Những gì bắt buộc phải giữ dùng chung

### 1. Tìm kiếm và lọc

- Mọi màn danh sách có tìm kiếm phải tìm trên toàn bộ thông tin hiển thị hoặc thông tin liên quan cần tra cứu, không chỉ 1 đến 2 cột.
- Input phải phản hồi ngay khi người dùng gõ; không debounce trực tiếp trên ô nhập.
- Debounce chỉ áp dụng ở lớp intent dùng cho API, URL hoặc export.
- Chuẩn thời gian:
  - Tìm kiếm chữ: `650ms`
  - Lọc số: `300ms`
  - Click hoặc chọn giá trị: không debounce
- Các màn hình có search/filter phải đi theo cùng một pattern dùng chung, không tự viết kiểu riêng cho từng trang.

### 2. Bố cục khu lọc

- Khu lọc nằm trong một container rõ ràng, dễ nhìn.
- Các ô lọc cùng chiều cao, cùng nhịp khoảng cách, cho phép xuống dòng khi thiếu chỗ.
- Có xóa riêng từng ô và có nút xóa toàn bộ bộ lọc.
- Mọi màn danh sách chuẩn phải bám theo bố cục tham chiếu của `ProductList`, không tự sáng tạo layout mới nếu bản chất thao tác giống nhau.

### 3. Xóa nhanh và nhập nhanh

- Không dùng `allowClear` của Ant Design.
- Mọi input/search/filter dùng `QuickClearIcon` làm chuẩn xóa nhanh.
- `Tab` và `Shift+Tab` đi theo thứ tự logic.
- `Enter`:
  - Chưa phải ô cuối: sang ô kế tiếp
  - Ô cuối của form: lưu
  - Ô cuối của bộ lọc: áp dụng lọc
- `Esc`: xóa giá trị ô hiện tại khi phù hợp.
- Select không tự mở khi focus; chỉ mở khi người dùng chủ động.

### 4. Tùy chọn người dùng và cài đặt cột

- Toàn hệ thống chỉ dùng một mô hình lưu cấu hình người dùng chung.
- Chỉ dùng `UserPreferences` và `useUserPreferences(page)` để lưu cấu hình theo màn.
- Không tạo model, API hay hook riêng cho từng trang chỉ để lưu cột, filter, sort, page size, layout hoặc tab.
- Cài đặt cột phải đi theo pattern dùng chung, không viết mỗi màn một kiểu chọn cột khác nhau.

### 5. Danh sách, xóa một dòng, xóa nhiều dòng, thông báo

- Danh sách chuẩn phải có phân trang, sắp xếp, trạng thái chọn dòng và thao tác xóa đồng nhất.
- Xóa một dòng và xóa nhiều dòng phải dùng cùng thông điệp xác nhận, cùng cách báo thành công/thất bại.
- Toast và map lỗi API phải dùng chung, không để mỗi màn trả thông báo theo một phong cách khác nhau.
- Nếu một màn là danh sách nghiệp vụ thông thường, mặc định dùng lại các hook dùng chung cho xóa, chọn dòng và phản hồi lỗi.

### 6. Trạng thái màn hình

- Mọi màn chính phải thể hiện rõ 4 trạng thái: loading, empty, error, success.
- Empty state phải có thông điệp rõ ràng, nhất quán và dễ hành động.
- Route loading nên dùng cùng phong cách loading screen dùng chung.
- Không để màn hình trống, đơ, hoặc chỉ hiện spinner mà không có ngữ cảnh.

### 7. Điều hướng và không gian làm việc

- Các pattern như `PageHeader`, `GlobalCommandPalette`, `TaskQuickLauncher`, `TaskWorkspaceModal`, `workspaceHeaderMeta`, `RouteLoadingScreen` là hạ tầng dùng chung.
- Khi bài toán chỉ là điều hướng, mở nhanh, quay lại nguồn, hoặc hiển thị tiêu đề không gian làm việc, phải ưu tiên dùng lớp chung hiện có.
- Không tạo thêm menu, launcher hoặc command center mới nếu vấn đề đã được giải quyết bởi hệ thống điều hướng dùng chung.

## Những gì được phép cấu hình nhưng vẫn phải ở trong bộ dùng chung

- Tên `pageKey` cho user preferences
- Danh sách cột hiện/ẩn
- Tập field lọc của từng module
- Nội dung empty state, helper text, CTA
- Danh mục lệnh trong command palette
- Meta hiển thị ở workspace header

## Những gì nên làm riêng

- Planning board, scan flow, command center chuyên biệt
- Detail drawer hoặc detail workspace có luồng nghiệp vụ riêng
- Dashboard phân tích và cockpit quản trị
- Các biểu mẫu có công thức hoặc quy trình khác biệt theo module

## Không nên

- Không nhân bản search, filter, clear, delete, toast, loading state thành nhiều phiên bản na ná nhau.
- Không coi nhãn "Bộ 54" là danh sách kỹ thuật đầy đủ các hàm dùng chung.
- Không tự tạo UX riêng cho một màn chỉ vì khác tên trường.
- Không để frontend trở thành nguồn chốt quy tắc nghiệp vụ.
- Không dùng chung một cách cưỡng ép nếu khác biệt thật sự nằm ở ý nghĩa nghiệp vụ.

## Kết luận ngắn

- Dùng chung mạnh ở phần trải nghiệm lặp lại.
- Làm riêng rõ ở phần làm thay đổi ý nghĩa nghiệp vụ.
- Nếu phân vân, mặc định dùng chung trước rồi mới tách riêng khi có lý do đủ mạnh.
