# Phase 2: Bán được hàng

Trạng thái: **Đang làm** (bắt đầu 2026-10-21)
Quyết định liên quan: [decisions.md](../decisions.md) T14 (cổng thanh toán / ship / thuế với bản mặc định)

## 1. Mục tiêu

Khách chọn option và thiết kế (Phase 1) → **thêm vào giỏ → checkout → đặt hàng**. Xưởng nhận đơn trong admin, xác nhận thanh toán, in, nhập mã tracking. Khách nhận email ở mỗi bước và theo dõi được đơn.

## 2. Phần phụ thuộc hãng: bản mặc định (decision T14)

| Phần | Bản mặc định trong Phase 2 | Khi chọn hãng (open issue) |
|---|---|---|
| Thanh toán | **Thủ công**: đơn tạo ra ở trạng thái *Chờ thanh toán*; nhân viên nhận tiền ngoài hệ thống rồi bấm "Đã thanh toán" trong admin. Dev có nút giả lập. | S6: thêm Stripe / Square / PayPal, trả thẻ ngay khi checkout |
| Ship | **Bảng phí cố định** (`shipping_methods`, có sẵn), miễn phí từ $100. Nhân viên **nhập mã tracking tay**, hệ thống email cho khách. | S1: EasyPost / Shippo, giá thật theo địa chỉ, in nhãn tự động |
| Sales tax | **Bảng thuế suất theo bang** (`tax_rates`), seed California 7.25% (số tạm). Tính trên tiền hàng, không tính trên phí ship. | S7: Stripe Tax / TaxJar / Avalara |

Code chỉ gọi qua 3 cổng: `PaymentProvider`, `ShippingRateProvider`, `TaxProvider`. Đổi hãng = thêm một phần cắm, không sửa giỏ hàng, checkout hay đơn hàng.

## 3. Các bước

| Bước | Việc | Kết quả kiểm tra được | Phụ thuộc chưa chốt |
|---|---|---|---|
| 1 ✅ | **Data model**: giỏ hàng, đơn hàng, thanh toán, lô gửi hàng, bảng thuế suất (migration + seed) | Mở DB thấy bảng và dữ liệu mặc định | — |
| 2 ✅ | **3 cổng + bản mặc định**: thanh toán thủ công, phí ship theo bảng, thuế theo bang; hàm tính tổng tiền dùng chung | Unit test: phí ship, ngưỡng miễn phí, thuế, làm tròn | Bản mặc định thay cho S6/S1/S7 |
| 3 ✅ | **Giỏ hàng**: API giỏ (guest bằng cookie), nút "Add to cart" lưu cấu hình + thiết kế (upload logo lên S3), trang giỏ hàng | Thêm/sửa số lượng/xoá; giá server tính lại | — |
| 4 ✅ | **Checkout**: email, địa chỉ Mỹ, phương thức ship, thuế, tổng tiền, đặt hàng → trang xác nhận | Đặt được đơn, server kiểm tra lại toàn bộ giá | S9 (link Terms/Privacy để trống) |
| 5 ✅ | **Email + trang theo dõi đơn** (link bảo mật trong email; Mailpit ở dev) | Đặt hàng xong có email, mở link xem trạng thái | Nhà cung cấp email production (chọn khi deploy) |
| 6 ✅ | **Admin đơn hàng**: danh sách, chi tiết, "Đã thanh toán", nhập tracking → email, huỷ đơn | Xử lý một đơn từ đầu tới cuối trong admin | — |
| 7 ✅ | **Xuất file in** từ template: PDF có bleed, nhúng font | Tải PDF in của một đơn từ admin | U8 (font): dùng tạm font license OFL |
| 8 ✅ | **Preflight + proof** phía server (worker Python): kiểm tra DPI, font, màu; ảnh proof; khách duyệt | Đơn có cảnh báo phải được khách xác nhận mới vào sản xuất | — |
| 9 ✅ | **Ngày giao dự kiến**: giờ chốt 2pm PT, ngày làm việc, ngày lễ | "Order by 2 PM PT to ship by …" đúng ở các trường hợp cuối tuần, ngày lễ | — |
| 10 ✅ | **Tài khoản khách**: đăng ký / đăng nhập, lịch sử đơn, đặt lại đơn cũ | Khách xem lại và đặt lại đơn cũ | — |
| 11 ✅ | **Admin**: quản lý tài khoản nhân viên (A2), nhật ký thay đổi (A1) | Thêm nhân viên, đổi mật khẩu, xem ai sửa gì | — |

Mỗi bước xong là chạy được và kiểm tra được.

## 4. Data model (bước 1)

```
tax_rates          state (2 chữ), rate_bps (725 = 7.25%), label, is_active
carts              id, token_hash (cookie khách), customer_id (bước 10), created_at, updated_at
cart_items         id, cart_id, product_code, configuration JSONB (selection, quantity, customSize),
                   design JSONB (mode template|upload, templateCode, values, file keys),
                   unit snapshot: total_cents tại lúc thêm (server tính lại khi checkout)
orders             id, number (dãy số tăng dần, hiển thị #100001), email, customer_id,
                   status (placed | in_production | shipped | completed | cancelled),
                   payment_status (unpaid | paid | refunded),
                   shipping_address JSONB, shipping_method snapshot, tax snapshot,
                   subtotal / shipping / tax / total (cents), access_token_hash (link theo dõi),
                   placed_at, paid_at, shipped_at, cancelled_at
order_items        id, order_id, snapshot cấu hình + thiết kế + giá, proof_status, production_status
payments           id, order_id, provider ('manual' | 'stripe' ...), status, amount_cents,
                   reference, recorded_by, created_at
shipments          id, order_id, carrier, service, tracking_number, shipped_at, created_by
```

Quy tắc giữ nguyên từ spec: tiền là số nguyên cent; đơn hàng lưu snapshot nên đổi giá hay cấu hình sau đó không ảnh hưởng đơn cũ.

## 5. Còn mở (ghi trong open-issues.md)

S1, S6, S7, S8, S9 (hãng ship / thanh toán / thuế, thuế phí ship, Terms & Privacy), U8 (font), I7 (staging).
