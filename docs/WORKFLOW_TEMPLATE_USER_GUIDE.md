# Huong dan su dung - Workflow Template

Tai lieu nay danh cho nguoi dung van hanh (khong can ky thuat).

## 1) Muc tieu

- Tao mau giao viec theo quy trinh de he thong tu sinh task.
- Ap dung tot cho luong: don hang -> mua hang -> san xuat -> QC -> giao hang.

## 2) Tao mau nhiem vu

1. Mo menu `Template nhiem vu`.
2. Bam `Them mau`.
3. Nhap:
   - `Loai doi tuong`: vi du `SalesOrder`.
   - `Su kien kich hoat`: vi du `SUBMIT` hoac `APPROVE`.
   - `Tieu de nhiem vu`: co the dung `{entity_code}`.
4. Cai dat them:
   - `Phu thuoc buoc truoc`: bat de tao chuoi cong viec.
   - `Chan san xuat`: bat neu buoc nay la gate bat buoc.
5. `Quy tac gan nguoi`:
   - Khong gan: `{}`
   - Gan theo role: `{"type":"role","value":"Sales"}`
   - Gan theo user: `{"type":"user","id":5}`
6. Bam `Tao`.

## 3) Ap template vao don hang/entity

1. Vao `Dieu hanh nhiem vu`.
2. Mo `Mo task` cua entity can giao viec.
3. Bam `Ap template`.
4. Chon trigger.
5. Bam `Xem truoc`:
   - Cot `Se tao`/`Bo qua` giup biet task moi hay da ton tai.
   - Cot `Phu thuoc` cho biet task nao se cho buoc truoc.
6. Bam `Tao ... nhiem vu`.

## 4) Luu y van hanh quan trong

- He thong co chong tao trung (idempotency): ap lai cung trigger se khong nhan doi task.
- Neu bat `Phu thuoc buoc truoc`, task sau chi nen xu ly khi task truoc xong.
- Neu bat `Chan san xuat`, can hoan thanh task hoac bo chan truoc khi san xuat.

## 5) Mau de xuat cho nganh carton

- Trigger `SUBMIT`:
  - Kiem tra thong tin don
  - Dat nguyen lieu
  - Xep lich san xuat
- Trigger `APPROVE`:
  - Trien khai san xuat
  - QC dau ra
  - Chuan bi giao hang

Nen bat `Phu thuoc buoc truoc` cho chuoi nay de han che bo sot ban giao.
