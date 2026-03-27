# Nên và không nên cho chủ dự án

## Mục tiêu

Đây là bản ra quyết định ngắn gọn cho chủ dự án không chuyên kỹ thuật. Khi phân vân một chức năng nên dùng chung hay viết riêng, hãy ưu tiên theo tài liệu này.

## Nên

- Nên giữ một bộ tài liệu chuẩn duy nhất để AI và người làm việc cùng đọc.
- Nên dùng chung các phần lặp lại ở nhiều màn hình:
  - tìm kiếm
  - lọc
  - nhập nhanh
  - xóa nhanh
  - thông báo
  - loading, empty, error, success
  - cài đặt cột và nhớ bộ lọc
  - command palette, quick launcher, page header
- Nên dùng chung các quy tắc nền:
  - mã chứng từ
  - làm tròn tiền và số lượng
  - quyền thao tác theo trạng thái
  - audit và truy vết
  - snapshot khi ghi sổ
- Nên làm riêng những phần quyết định bản chất nghiệp vụ:
  - giá
  - chiết khấu
  - tồn kho
  - sản xuất
  - hạch toán
  - phê duyệt
  - kế hoạch
  - đối soát
- Nên để backend là nơi chốt đúng/sai cuối cùng.

## Chỉ nên làm riêng khi

- Màn hình đó có luồng thao tác khác hẳn danh sách chuẩn.
- Quy tắc riêng làm thay đổi số liệu hoặc hậu quả nghiệp vụ.
- Người dùng thực sự cần bố cục khác để thao tác nhanh hơn trong ngữ cảnh thực tế.
- Nếu giữ chung sẽ làm sai ý nghĩa chứng từ hoặc gây rủi ro dữ liệu.

## Không nên

- Không để nhiều file cùng nói một quy tắc theo nhiều cách khác nhau.
- Không giữ báo cáo phase, ghi chú buổi làm việc, file hoàn thành hoặc spec cũ trong luồng đọc chính.
- Không nghĩ rằng "54 chức năng" đồng nghĩa với "54 bộ code riêng".
- Không nghĩ rằng cái gì cũng phải ép dùng chung.
- Không để mỗi module tự làm một kiểu search, filter, delete, loading hoặc thông báo.
- Không để frontend tự quyết định quy tắc nghiệp vụ mà backend chưa chốt.
- Không cho sửa tự do chứng từ sau duyệt hoặc sau ghi sổ nếu chưa có lý do và kiểm soát rõ ràng.

## Cách quyết nhanh trong 10 giây

- Nếu là trải nghiệm lặp lại: dùng chung.
- Nếu là logic làm đổi số liệu hoặc trạng thái: làm riêng.
- Nếu đang có hai tài liệu nói khác nhau: gộp về một tài liệu chuẩn rồi xóa bản còn lại.
- Nếu chưa chắc có nên mở ngoại lệ không: mặc định chọn phương án an toàn hơn.

## Kết luận ngắn

- Dùng chung mạnh ở phần trải nghiệm.
- Làm riêng rõ ở phần nghiệp vụ.
- Giữ ít tài liệu nhưng đúng và còn hiệu lực.
