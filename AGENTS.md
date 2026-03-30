# AGENTS.md

## Vai trò của tài liệu này

- Đây là file duy nhất dùng để điều phối AI và người giao việc trong repo này.
- Khi cần quyết định hướng làm, hãy ưu tiên theo thứ tự:
  1. Yêu cầu mới nhất của người dùng trong phiên hiện tại.
  2. Nội dung trong `AGENTS.md`.
  3. Code và config đang có thật trong repo.
- Không dùng các báo cáo cũ, đặc tả cũ, file tổng kết cũ hoặc tài liệu đã bị xóa để quyết định hướng làm tiếp.
- Nếu cần xem lịch sử, dùng Git; không tạo lại các file kiểu báo cáo tổng kết riêng.

## Thực trạng kỹ thuật hiện tại

- `backend/`: Django + Django REST Framework.
- `frontend/`: React + Vite + TypeScript + Ant Design.
- ERP có nhiều màn hình nghiệp vụ; nếu màn hình đang dùng tiếng Việt thì giữ nguyên tiếng Việt cho label, placeholder, message, test và nội dung hướng dẫn liên quan.
- Contract API mặc định hiện tại là `/api/v1`.
- `/api` chỉ còn là alias tương thích tạm thời, không phải hướng mặc định cho phát triển mới.
- Repo hiện đã hỗ trợ tách frontend và backend:
  - frontend gọi API qua biến cấu hình
  - backend đã có cấu hình `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, proxy header và các biến môi trường phục vụ việc tách lớp
- Mẫu deploy hiện có vẫn đang thiên về chạy theo cùng một cụm dịch vụ; điều đó có nghĩa là repo đã đi đúng hướng để tách lớp, nhưng chưa được coi là mô hình hybrid hoàn chỉnh.
- Nguồn sự thật kỹ thuật luôn là code và config đang có thật trong repo, không phải mô tả kỳ vọng hay tài liệu cũ.

## Pattern dùng chung đang còn hiệu lực

- Khi cần lưu cấu hình theo người dùng cho một màn hình, dùng `UserPreferences` ở backend và hook `useUserPreferences(page)` ở frontend; không tạo model hoặc hook riêng chỉ cho một màn hình.
- Khi làm search/filter cho màn danh sách, ưu tiên dùng `useSearchFilterIntent`:
  - input đổi ngay để người dùng gõ mượt
  - intent mới là phần debounce để gọi API, sync URL hoặc export
  - không bind ngược dữ liệu từ query về ô nhập theo cách làm nhảy chữ
- Khi màn hình đã dùng `QuickClearIcon`, tiếp tục dùng chuẩn đó cho ô nhập/search/filter; không quay lại `allowClear` của Ant Design.
- Với màn danh sách có tìm kiếm toàn cột, ưu tiên giữ hướng backend gom dữ liệu tìm kiếm trên các cột hiển thị thay vì chỉ tìm một cột đơn lẻ.
- Nếu một form hoặc bộ lọc đã có quy tắc nhập nhanh bằng bàn phím, hãy giữ hành vi Tab, Enter, Esc và luồng focus nhất quán với màn hình hiện có; không tự ý đổi sang hành vi khác khi chưa có lý do rõ ràng.

## Đích triển khai hybrid cuối cùng

- Frontend chạy public qua tên miền.
- Backend, PostgreSQL, file upload, worker và scheduler chạy trên Mini PC ở công ty.
- Dữ liệu chính nằm ở công ty.
- Không mở database trực tiếp ra internet.
- Có backup tại chỗ và backup lên Google Drive.
- Mọi thay đổi mới phải giữ cho hệ thống tiếp tục đi đúng hướng này:
  - không hardcode `localhost`
  - không giả định frontend và backend luôn ở cùng một máy
  - không làm thay đổi khiến sau này phải quay lại sửa lớn chỉ để tách lớp triển khai

## Nguyên tắc làm việc bắt buộc cho AI

- Hoàn thành task end-to-end, chỉ dừng khi gặp blocker thật sự.
- Tự tìm file liên quan và tự sửa nhiều file trong phạm vi task khi cần.
- Đọc luồng hiện có trước khi sửa; tận dụng code, pattern và component sẵn có.
- Với thay đổi liên quan nhiều lớp, xử lý trọn luồng backend -> API -> frontend -> test -> tài liệu liên quan.
- Nếu sửa hoặc làm mới một flow, phải làm đồng bộ và hoàn chỉnh; không làm lẻ từng phần rồi để quay lại vá sau.
- AI phải gom việc theo tranche đủ lớn để làm liên tục tối đa trong một phiên, tránh ngắt quãng và tránh tạo kế hoạch lặp đi lặp lại cho cùng một flow.
- Không dừng ở mức phân tích hay đề xuất nếu vẫn có thể tự triển khai và kiểm tra tiếp.
- Không tự chia task thành từng gói để dừng chờ xác nhận, trừ khi:
  - gặp blocker thật sự
  - scope thay đổi đáng kể so với yêu cầu ban đầu
  - có nguy cơ phá chức năng cũ và cần chốt lại trước
- Ưu tiên giải pháp đơn giản, dễ bảo trì; nếu có nguy cơ phá chức năng cũ, phải xác nhận trước khi sửa.
- Không thêm abstraction hoặc kiến trúc phức tạp nếu chưa cần.
- Không sửa lan rộng ngoài phạm vi task nếu không có lý do rõ ràng.

## Chuẩn hoàn thành cho mỗi task

- Phần thay đổi phải hoàn tất theo đúng luồng nghiệp vụ bị ảnh hưởng, không để sót backend hoặc frontend hoặc test hoặc tài liệu.
- Mọi màn hình liên quan nên có trạng thái loading, empty, error, success rõ ràng.
- Form và thao tác ghi dữ liệu phải có validation hợp lý, thông báo dễ hiểu, tránh lỗi mơ hồ.
- Không hy sinh quyền hạn, auditability hoặc tính toàn vẹn dữ liệu để đổi lấy tốc độ làm nhanh.
- Ưu tiên trải nghiệm chuyên nghiệp, hiện đại, nhất quán và dễ dùng.
- Ưu tiên responsive tốt trên desktop và điện thoại; nếu làm mới hoặc sửa đáng kể một màn hình thì phải kiểm tra luôn khả năng dùng trên điện thoại.
- Nếu màn hình đang dùng tiếng Việt thì phải chuẩn hóa tiếng Việt dễ đọc, không để text lỗi, text lẫn ngôn ngữ hoặc nội dung mơ hồ.
- Với thay đổi quan trọng, phải bổ sung hoặc cập nhật test hồi quy phù hợp.
- Không kết thúc task trong trạng thái còn thiếu bước kiểm tra quan trọng mà không nêu rõ lý do.

## Kiểm tra trước khi kết thúc

- Frontend: `cd frontend && npm run lint`
- Frontend: `cd frontend && npm run build`
- Backend: `cd backend && python manage.py test core.tests_auth_smoke core.tests_module_permissions core.tests_operations_log`
- Nếu thay đổi ảnh hưởng luồng chính hoặc end-to-end, ưu tiên chạy thêm:
  - `cd backend && python manage.py smoke_http --backend-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:5173 --username uat_admin --password Demo123!`
  - `cd frontend && npm run e2e:smoke`
- Nếu có bước không chạy được, phải nêu rõ blocker, phạm vi ảnh hưởng và phần chưa verify.

## Quy tắc tài liệu

- Từ nay repo chỉ giữ:
  - `AGENTS.md` làm tài liệu điều phối
  - `README.md` làm trang mở đầu rất ngắn cho repo
- Không tạo file trạng thái mới.
- Không tạo lại các file tổng kết kiểu báo cáo hoàn tất, báo cáo cuối, trạng thái, báo cáo bàn giao hoặc đặc tả tổng hợp để làm đầu mối song song.
- Nếu sau này cần tài liệu vận hành thật, hãy dựng lại từ code và hạ tầng thực tế lúc đó.
