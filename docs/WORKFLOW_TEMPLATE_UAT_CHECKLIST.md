# UAT Checklist - Workflow Template

Checklist nay dung de kiem tra nhanh tinh nang "Mau nhiem vu Workflow" truoc khi dua vao van hanh.

## 1) Chuan bi du lieu

- Dang nhap bang tai khoan co quyen quan tri.
- Co it nhat 1 don hang SalesOrder de test.
- Co it nhat 2 user de test giao viec.

## 2) Quan ly mau nhiem vu

- Mo menu `Template nhiem vu`.
- Tao moi 1 mau:
  - `Loai doi tuong`: SalesOrder
  - `Su kien`: SUBMIT
  - `Tieu de`: Kiem tra don {entity_code}
  - `assign_rule`: `{}`
- Luu thanh cong va thay mau trong bang.
- Sua mau vua tao, doi uu tien hoac han, luu thanh cong.
- Bat/tat `Kich hoat` bang switch, refresh trang van dung gia tri dung.

## 3) Kiem tra assign_rule an toan

- Nhap `assign_rule` sai dinh dang (vi du: `abc`) -> he thong bao loi de hieu.
- Nhap `{"type":"role","value":"Sales"}` -> luu thanh cong.
- Nhap `{"type":"user","id":"5"}` -> luu thanh cong (id duoc xu ly dung).
- Nhap `{"type":"role"}` -> API bao loi do thieu `value`.

## 4) Preview va generate task

- Vao `Dieu hanh nhiem vu` -> mo `Mo task` tren 1 entity.
- Bam `Ap template`.
- Chon trigger phu hop (SUBMIT/APPROVE...).
- Bam `Xem truoc`:
  - Co danh sach task se tao.
  - Co cot trang thai `Se tao` / `Bo qua`.
- Bam `Tao N nhiem vu`:
  - Thong bao tao thanh cong.
  - Task xuat hien trong danh sach TaskPanel.

## 5) Kiem tra idempotency (khong tao trung)

- Lap lai `Ap template` voi cung entity + cung trigger.
- Ket qua mong doi:
  - Preview hien `Bo qua` cho task da ton tai.
  - Bam tao khong sinh trung task.

## 6) Kiem tra van hanh task

- Bat dau task -> chuyen trang thai `Dang thuc hien`.
- Hoan thanh task -> chuyen `Hoan thanh`.
- Thu tao task co `is_blocking` va kiem tra nhan/canh bao blocking hien dung.
- Thu add note, comment, file dinh kem de dam bao khong bi loi.

## 7) Kiem tra UI dung chuan dung chung

- O tim kiem tren `Template nhiem vu`, `Dieu hanh nhiem vu`, `Giao nhiem vu nhanh` co icon xoa nhanh.
- Cot hien thi co the bat/tat bang nut `Cot`.
- Bo loc xoa duoc bang nut `Xoa bo loc`.

## 8) Tieu chi PASS

- Khong co loi 500 khi tao/sua/generate template.
- Khong tao trung task khi generate lai.
- Task sinh ra dung entity, dung trigger, dung uu tien/han.
- Nguoi dung khong IT thao tac duoc theo huong dan ma khong can sua code.
