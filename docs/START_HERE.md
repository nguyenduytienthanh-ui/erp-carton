# Bộ tài liệu chuẩn ERP Carton

## Mục tiêu

File này là điểm vào chính thức cho người dùng, chủ dự án và AI.
Chỉ các tài liệu được liệt kê tại đây mới được xem là nguồn chuẩn còn hiệu lực.

## Thứ tự đọc cho chủ dự án

1. `docs/OWNER_DECISION_GUIDE.md`
2. `docs/BUSINESS_RULES_STANDARD.md`
3. `docs/MODULE_RULES_STANDARD.md`

## Thứ tự đọc cho AI và người thực thi

1. `AGENTS.md`
2. `.cursorrules`
3. `docs/COMMON_RULES_STANDARD.md`
4. `docs/BUSINESS_RULES_STANDARD.md`
5. `docs/MODULE_RULES_STANDARD.md`

## Nguồn chuẩn còn hiệu lực

- `README.md`: điểm vào ngắn gọn cho repo, cách chạy ứng dụng và các liên kết chính.
- `AGENTS.md`: nguyên tắc làm việc, tiêu chuẩn chất lượng và lệnh kiểm tra trước khi kết thúc.
- `.cursorrules`: bộ guardrail ngắn cho AI, chỉ giữ các quy tắc bắt buộc và trỏ link về tài liệu chuẩn.
- `docs/COMMON_RULES_STANDARD.md`: bộ quy tắc dùng chung bắt buộc cho giao diện, thao tác và trải nghiệm.
- `docs/BUSINESS_RULES_STANDARD.md`: quy tắc nghiệp vụ lõi áp dụng toàn hệ thống.
- `docs/MODULE_RULES_STANDARD.md`: ranh giới giữa phần dùng chung và phần cần làm riêng theo module.
- `docs/OWNER_DECISION_GUIDE.md`: bản "nên / không nên" ngắn gọn cho chủ dự án.
- `docs/GIT_WORKFLOW_GUIDE.md`: quy trình đồng bộ làm việc hằng ngày và nguyên tắc Git an toàn.

## Tài liệu vận hành giữ lại

Các tài liệu dưới đây vẫn cần thiết, nhưng chỉ dùng cho mục đích vận hành hoặc go-live; không dùng để chốt quy tắc nghiệp vụ nền:

- `docs/SETUP_MACHINE_MOI.md`
- `docs/UAT_DEMO_USERS.md`
- `docs/DEPLOYMENT_GUIDE.md`
- `docs/PRODUCTION_RUNBOOK.md`
- `docs/MONITORING_ALERTING.md`
- `docs/STAGING_REHEARSAL_CHECKLIST.md`
- `docs/PERFORMANCE_READINESS.md`
- `docs/GO_LIVE_HANDOFF.md`
- `docs/RELEASE_LOCK.md`
- `docs/RELEASE_HYGIENE.md`
- `deploy/README.md`

## Nguyên tắc đọc và cập nhật

- Mỗi chủ đề chỉ có một nguồn chuẩn.
- Nếu một quy tắc quan trọng đang xuất hiện ở nhiều file, phải gộp lại về đúng một file chuẩn.
- Nếu tài liệu chuẩn và code/test không khớp, ưu tiên kiểm tra code/test rồi cập nhật lại tài liệu chuẩn.
- "54 chức năng" là phạm vi năng lực của sản phẩm, không phải 54 bộ dùng chung bắt buộc phải tái sử dụng cùng một cách.

## Nguyên tắc quyết định nhanh

- Giao diện và thao tác lặp lại ở nhiều màn hình: ưu tiên dùng chung.
- Quy tắc làm thay đổi số liệu, trạng thái, phê duyệt, tồn kho, giá, công nợ hoặc hạch toán: ưu tiên xử lý riêng theo nghiệp vụ.
- Báo cáo phase, ghi chú buổi làm việc, tài liệu hoàn thành, spec cũ và tài liệu marketing không được dùng làm nguồn chuẩn.
