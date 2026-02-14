# Search & Filter Guideline (BẮT BUỘC)

## Tìm kiếm phải gồm TẤT CẢ các cột (áp dụng cho mọi danh mục/chức năng)

**Quy tắc:** Mọi chức năng tìm kiếm (tìm chính xác, không chính xác, tiếng Việt có dấu, không dấu, v.v.) phải tìm trên **tất cả các cột** của bảng tương ứng.

**Cách làm (Backend):**
- Có một trường tổng hợp (vd. `search_text`) trên model.
- Hàm build (vd. `_build_search_text()`) gộp **mọi cột hiển thị**:
  - Text: code, name, description, note, …
  - Số: giá, số lượng, các cột công đoạn (process_*), …
  - Quan hệ: tên + mã của category, wave, unit, …
  - Choice: cả value và label (vd. status, waterproof).
  - Nhãn cột khi có giá trị: ví dụ cột "Đóng", "Dán" → thêm chuỗi "Đóng", "Dán" vào search_text khi cột có giá trị, để tìm "đóng"/"dán" vẫn ra.
- Chuẩn hóa: `unidecode(combined).lower()` để tìm được cả có dấu và không dấu.
- Lưu: gọi build trong `save()`; có migration rebuild cho dữ liệu cũ.

**Cách làm (View/API):**
- Tìm thường: token hóa từ khóa → AND trên `search_text__icontains` (mỗi token).
- Tìm chính xác: `search_text__icontains=normalized` và (nếu cần) `search_text__icontains=search_raw` (có dấu).

**Khi thêm module mới (Đơn hàng, Khách hàng, Công đoạn, …):** Làm tương tự: model có `search_text` (hoặc tên tương đương), build từ **tất cả** cột, API filter theo trường đó. Không tìm chỉ vài cột cố định.

---

## Nguyên tắc cốt lõi
- Input chỉ dùng để nhập, KHÔNG debounce
- Intent dùng debounce, chỉ dùng cho API / URL / export
- Query chỉ đọc intent, không bao giờ đọc input

## Debounce rule
- Search text: 650ms
- Filter số (Dài/Rộng/Cao/Giá): 300ms
- Filter click/select: không debounce

## Tuyệt đối KHÔNG làm
- Không bind input.value với intent/query
- Không set lại input từ API response
- Không debounce input
- Không dùng key động cho filter panel

## Hook chuẩn
- useSearchFilterIntent là hook dùng chung
- Mọi màn hình có search/filter đều PHẢI dùng hook này

## Thứ tự luồng
User gõ → input state đổi ngay → debounce → intent đổi → gọi API / sync URL

---

**Tham chiếu:** `.cursorrules` §2, `frontend/src/hooks/useSearchFilterIntent.ts`, ProductList (search + filter dùng hook này).
