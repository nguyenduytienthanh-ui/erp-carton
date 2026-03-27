# Quy tắc nghiệp vụ lõi

## Mục tiêu

Tài liệu này chốt các quy tắc nghiệp vụ nền phải giữ ổn định toàn hệ thống. Đây là phần dùng chung ở tầng dữ liệu, chứng từ, phân quyền và kiểm soát thay đổi; không phải danh sách toàn bộ logic riêng của từng module.

## 1. Chuẩn master data

- Master data chuẩn phải có ít nhất: `code`, `name`, trạng thái hoạt động, audit fields và khả năng lọc/sắp xếp hợp lý.
- Với loại master phù hợp, mặc định ưu tiên `soft delete` thay vì xóa vật lý.
- Mã dùng cho master data phải ổn định, dễ tra cứu và không để trùng trên bản ghi còn hiệu lực.
- View, filter, export, bulk action và audit của master data nên đi theo cùng một chuẩn nền.
- Nếu một master mới không có lý do đặc biệt, nó phải quay về chuẩn master data dùng chung thay vì tự nghĩ mô hình khác.

## 2. Chuẩn chứng từ

- Mọi chứng từ cần có mã chứng từ rõ ràng, có kỳ, có trạng thái và có lịch sử thao tác.
- Chuẩn đánh số mặc định là theo `doc_type + kỳ YYYYMM + số tăng dần`.
- Khi chứng từ đã được ghi sổ hoặc khóa, dữ liệu tham chiếu quan trọng phải được chụp snapshot để về sau master data thay đổi không làm sai lịch sử.
- Mọi thao tác ghi sổ phải đi trong transaction và có tính idempotent nếu phù hợp.
- Hành vi chuẩn sau khi `APPROVED` hoặc `POSTED`: không cho sửa tự do. Nếu cần thay đổi phải đi qua đường kiểm soát như reopen có lý do, void, reversal hoặc bước nghiệp vụ chuyên biệt.

## 3. Tiền, số lượng và cách tính

- Tiền mặc định làm tròn `2` số lẻ theo `HALF_UP`.
- Số lượng mặc định làm tròn `4` số lẻ nếu không có quy tắc đặc thù khác.
- Thứ tự tính chuẩn ở mức dòng:
  - `subtotal`
  - `discount`
  - `after_discount`
  - `tax`
  - `line_total`
- Không được để mỗi module tự đảo thứ tự discount/tax nếu chưa có quyết định nghiệp vụ rõ ràng.
- Nếu có khác biệt nghiệp vụ thật sự, phải ghi rõ là ngoại lệ của module đó.

## 4. Trạng thái, quyền và khóa thao tác

- Quyền thao tác luôn phụ thuộc đồng thời vào vai trò và trạng thái chứng từ.
- Backend là nơi chốt quyền cuối cùng; frontend chỉ hỗ trợ ẩn/hiện hoặc khóa nút cho trải nghiệm.
- Mỗi hành động quan trọng như sửa ngoại lệ, submit, approve, reject, post, void, cancel phải có kiểm soát trạng thái rõ ràng.
- Các thao tác hủy, từ chối, void và chỉnh sửa ngoại lệ phải có lý do rõ ràng; nếu nghiệp vụ cần, có thể bắt buộc comment hoặc attachment bổ sung.

## 5. Audit và truy vết

- Mọi thay đổi quan trọng phải có audit trail đủ để biết ai làm, khi nào làm, từ trạng thái nào sang trạng thái nào.
- Một thao tác bulk nên ghi nhận như một sự kiện bulk có danh sách đối tượng liên quan, không cần tách thành quá nhiều log lặp lại nếu không có giá trị quản trị thêm.
- Nếu có thay đổi sau bước duyệt hoặc ghi sổ, việc ghi lý do và dấu vết phải nghiêm ngặt hơn thay vì lỏng hơn.

## 6. Chia ranh giới dùng chung và làm riêng

### Phần phải coi là nền dùng chung

- Chuẩn master data
- Chuẩn chứng từ
- Chuẩn đánh số
- Chuẩn làm tròn tiền và số lượng
- Quy tắc quyền theo action + status
- Audit trail và truy vết
- Nguyên tắc post, void, reversal, snapshot

### Phần không nên ép dùng chung

- Công thức giá và chiết khấu đặc thù
- Luồng phê duyệt riêng của từng loại chứng từ
- Quy tắc cấp phát, giữ chỗ, xuất kho, hoàn kho
- Định mức, routing, sequencing, block reason trong sản xuất
- Liên kết chéo giữa sales, purchasing, inventory, production
- Báo cáo phân tích, dashboard điều hành và logic KPI

## 7. Cách hiểu đúng về "54 chức năng"

- `54 chức năng` là phạm vi năng lực của sản phẩm.
- `54 chức năng` không đồng nghĩa với việc mọi chức năng phải dùng cùng một bộ code hoặc cùng một luồng nghiệp vụ.
- Cái nên dùng chung là quy tắc nền và trải nghiệm lặp lại.
- Cái nên làm riêng là logic làm thay đổi số liệu, trạng thái, phê duyệt, giá, tồn kho, kế hoạch và hạch toán.

## 8. Khuyến nghị chốt từ nay

- Nếu chưa chắc, mặc định không cho sửa tự do sau duyệt hoặc ghi sổ.
- Nếu có thao tác ngoại lệ, phải có lý do và dấu vết.
- Nếu logic ảnh hưởng tiền, tồn, công nợ, sản lượng hoặc audit, ưu tiên backend service hoặc rule trung tâm thay vì chỉ khóa nút ở frontend.
- Nếu một quy tắc quan trọng đang tồn tại ở nhiều tài liệu, chỉ giữ lại một bản chuẩn và xóa các bản mô tả cũ.

## Kết luận ngắn

- Dùng chung ở tầng nền.
- Làm riêng ở tầng nghiệp vụ sâu.
- Không hy sinh tính đúng, tính audit và tính nhất quán để đổi lấy tốc độ viết nhanh.
