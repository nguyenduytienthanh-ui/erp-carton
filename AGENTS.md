# AGENTS.md

## Tài liệu chuẩn cần đọc

- `docs/START_HERE.md`
- `docs/COMMON_RULES_STANDARD.md`
- `docs/BUSINESS_RULES_STANDARD.md`
- `docs/MODULE_RULES_STANDARD.md`
- Không dùng tài liệu phase, report hoàn thành, spec cũ hoặc ghi chú buổi làm việc làm nguồn chuẩn.

## Mục tiêu

- Hoàn thành task end-to-end, chỉ dừng khi gặp blocker thật sự.
- Tự tìm file liên quan và tự sửa nhiều file trong phạm vi task khi cần.
- Ưu tiên giải pháp đơn giản, dễ bảo trì, nếu phá chức năng cũ, hãy xác nhận trước khi sửa.

## Bối cảnh dự án

- `backend/`: Django + Django REST Framework.
- `frontend/`: React + Vite + TypeScript + Ant Design.
- ERP có nhiều màn hình nghiệp vụ; nếu màn hình đang dùng tiếng Việt thì giữ nguyên tiếng Việt cho label, placeholder, message và nội dung test.

## Tiêu chuẩn chất lượng

- Ưu tiên trải nghiệm chuyên nghiệp, hiện đại, nhất quán và dễ dùng.
- Mọi màn hình nên có trạng thái loading, empty, error, success rõ ràng.
- Form và thao tác ghi dữ liệu phải có validation hợp lý, thông báo dễ hiểu, tránh lỗi mơ hồ.
- Tôn trọng quyền hạn, auditability và tính toàn vẹn dữ liệu; không hy sinh độ đúng để đổi lấy tốc độ làm nhanh.
- Ưu tiên responsive tốt, hiệu năng ổn định và tái sử dụng pattern/component sẵn có.
- Với thay đổi quan trọng, cần bổ sung hoặc cập nhật test hồi quy phù hợp.

## Cách làm việc

- Đọc luồng hiện có trước khi sửa; tận dụng code, pattern và component sẵn có.
- Ưu tiên quay về bộ dùng chung cho search, filter, quick entry, quick clear, delete, toast, loading, empty state, command palette và user preferences.
- Chỉ làm riêng khi khác biệt xuất phát từ nghiệp vụ, không phải vì muốn đổi cách viết UI.
- Với thay đổi liên quan nhiều lớp, xử lý trọn luồng backend -> API -> frontend -> test/docs liên quan.
- Chủ động cập nhật test, seed, config hoặc tài liệu ngắn nếu thay đổi làm chúng lệch thực tế.
- Không dừng ở mức phân tích hay đề xuất nếu vẫn có thể tự triển khai và kiểm tra tiếp.
- Không tự chia task thành từng gói để dừng chờ xác nhận; tiếp tục làm đến khi hoàn thành, trừ khi gặp blocker thật sự, scope thay đổi đáng kể so với yêu cầu ban đầu, hoặc cần xác nhận trước vì có nguy cơ phá chức năng cũ.

## Kiểm tra trước khi kết thúc

- Ưu tiên: `.\scripts\quality-check.ps1`
- Frontend: `cd frontend && npm run lint`
- Frontend: `cd frontend && npm run build`
- Backend: `cd backend && python manage.py test core.tests_auth_smoke core.tests_module_permissions core.tests_operations_log`
- Nếu thay đổi ảnh hưởng luồng chính hoặc end-to-end, ưu tiên chạy thêm:
  - `cd backend && python manage.py smoke_http --backend-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:5173 --username uat_admin --password Demo123!`
  - `cd frontend && npm run e2e:smoke`
- Nếu có bước không chạy được, phải nêu rõ blocker, phạm vi ảnh hưởng và phần chưa verify.

## Nguyên tắc an toàn

- Không tự ý đổi tiếng Việt sang tiếng Anh ở UI đang dùng tiếng Việt.
- Không thêm abstraction hoặc kiến trúc phức tạp nếu chưa cần.
- Không sửa lan rộng ngoài phạm vi task nếu không có lý do rõ ràng.
- Không để cùng một quy tắc quan trọng tồn tại ở nhiều tài liệu với cách diễn đạt khác nhau.