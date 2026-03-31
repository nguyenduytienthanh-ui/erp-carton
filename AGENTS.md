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
- Contract API là `/api/` (không có `/v1` prefix). Backend mount tại `path('api/', ...)` trong `backend/config/urls.py`.
- Repo đã đạt chuẩn hybrid hoàn chỉnh: deploy templates, nginx config, settings và env examples đều tách frontend/backend. Xem `deploy/` để biết cấu hình chi tiết.
- Frontend gọi API qua `VITE_API_BASE_URL` (biến môi trường) — không hardcode URL trong source code.
- Backend đã cấu hình đầy đủ `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `USE_X_FORWARDED_HOST`, `SECURE_PROXY_SSL_HEADER` và các biến môi trường phục vụ tách lớp.
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

### Khi thêm page/route mới phải wire đủ 4 nơi

Mỗi route mới phải được khai báo đồng bộ và nhất quán ở tất cả 4 nơi sau:

1. **`frontend/src/AppRouter.tsx`** — thêm `<Route>` với `FeatureRoute allow={canXxx}`.
2. **`frontend/src/components/Layout/MainLayout.tsx`** — thêm menu item với cùng điều kiện `canXxx ? {...} : null`.
3. **`frontend/src/utils/commandPalette.ts`** — thêm seed với `enabled: options.canXxx`.
4. **`frontend/src/pages/Dashboard.tsx`** — thêm shortcut card hoặc restored card nếu là chức năng quan trọng.

Condition `allow` / `enabled` / gate phải **giống hệt nhau** ở cả 4 nơi. Nếu route cho phép `canA || canB || canC`, thì menu, palette và Dashboard cũng phải dùng cùng biểu thức đó, không dùng subset hẹp hơn.

### Menu group mới phải có permission gate

Mọi menu group mới trong `MainLayout.tsx` phải có điều kiện:
```tsx
canManageX ? {
  key: 'x-group',
  label: '...',
  children: [...],
} : null,
```
Không được tạo group không có điều kiện (unconditional). Ai không có quyền thì không nhìn thấy group đó trong sidebar.

### Python import hygiene

- Tất cả `import` và `from X import Y` phải đặt **ở đầu file**, không đặt inline bên trong hàm, class hay phần giữa/cuối file.
- Khi thêm class/function mới vào file đã có, tích hợp import vào khối import hiện có ở đầu — không append thêm dòng import ở cuối file.
- Khi thêm model Django vào file đã định nghĩa `User = get_user_model()`, dùng lại biến `User` đó; không tạo alias mới như `_User = get_user_model()`.

### Fake migration pattern (khi bảng DB đã tồn tại)

Khi bảng đã tồn tại trong DB (từ migration cũ đã bị xóa khỏi repo):
1. Tạo migration bình thường bằng `makemigrations`.
2. Chạy `python manage.py migrate <app> --fake` để đánh dấu đã áp dụng mà không tạo lại bảng.
3. Ghi comment trong file migration: `# Tables already exist in DB; this migration is applied --fake.`

### Đồng bộ .env.hybrid.example

Mỗi khi thêm biến môi trường mới vào `backend/config/settings.py`, phải thêm luôn vào `backend/.env.hybrid.example` trong cùng commit. Không để `.env.hybrid.example` lạc hậu so với settings.

## Đích triển khai hybrid cuối cùng

- Frontend chạy public qua tên miền.
- Backend, PostgreSQL, file upload, worker và scheduler chạy trên Mini PC ở công ty.
- Dữ liệu chính nằm ở công ty.
- Không mở database trực tiếp ra internet.
- Có backup tại chỗ và backup lên Google Drive.
- Mọi thay đổi mới phải giữ cho hệ thống tiếp tục đi đúng hướng này:
  - không hardcode `localhost`, địa chỉ IP nội bộ, hay port cụ thể trong source code
  - không giả định frontend và backend luôn ở cùng một máy
  - không làm thay đổi khiến sau này phải quay lại sửa lớn chỉ để tách lớp triển khai

### Quy tắc kỹ thuật bắt buộc cho hybrid

- Mọi API call trong frontend phải đi qua `axiosInstance` từ `frontend/src/api/axios.ts`. Không dùng `fetch()` trực tiếp; không tạo `axios.create()` với URL hardcode.
- `VITE_API_BASE_URL` là nguồn sự thật duy nhất cho API base URL. Giá trị fallback dev-only chỉ được đặt một lần tại `frontend/src/utils/constants.ts` — không đặt URL mặc định ở bất kỳ file API nào khác.
- `frontend/Dockerfile` phải được build với **context là repo root** (`.`), không phải `context: ./frontend`, vì `COPY deploy/nginx/frontend.conf` cần đường dẫn từ root.
- Khi thêm biến proxy/security mới vào settings (`USE_X_FORWARDED_*`, `SECURE_*`), phải thêm cả giá trị production vào `backend/.env.hybrid.example`.

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
  - `cd backend && python manage.py smoke_http --backend-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:5174 --username uat_admin --password Demo123!`
  - `cd frontend && npm run e2e:smoke`
- Nếu có bước không chạy được, phải nêu rõ blocker, phạm vi ảnh hưởng và phần chưa verify.

## Quy tắc tài liệu

- Từ nay repo chỉ giữ:
  - `AGENTS.md` làm tài liệu điều phối
  - `README.md` làm trang mở đầu rất ngắn cho repo
- Không tạo file trạng thái mới.
- Không tạo lại các file tổng kết kiểu báo cáo hoàn tất, báo cáo cuối, trạng thái, báo cáo bàn giao hoặc đặc tả tổng hợp để làm đầu mối song song.
- Nếu sau này cần tài liệu vận hành thật, hãy dựng lại từ code và hạ tầng thực tế lúc đó.
