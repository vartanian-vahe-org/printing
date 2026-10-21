# Lộ trình

Cập nhật: 2026-10-21

| Phase | Mục tiêu | Mốc khi xong | Trạng thái |
|---|---|---|---|
| **1** | Configurator, giá, template / upload PDF, preview 3D, admin cơ bản | Demo cho khách | ✅ Code xong, chờ deploy staging ([phase-1.md](phase-1.md)) |
| **2** | **Bán được hàng** | Khách đặt và thanh toán. Xưởng in theo đơn (xử lý tay) | 🚧 Đang làm ([phase-2.md](phase-2.md)) |
| **3** | Tự động hoá xưởng | Đơn chạy từ web tới máy in và ra kho gần như không cần thao tác tay | ⬜ |
| **4** | Tăng trưởng và mở rộng | Thêm sản phẩm, giữ chân khách, công cụ marketing | ⬜ |

## Phase 3: Tự động hoá xưởng

- **Phiếu job**: mỗi sản phẩm trong đơn thành một job, có barcode/QR, trạng thái theo công đoạn
- **App xưởng** (tablet / máy quét): In → Cắt → Gia công → Đóng gói
- **Gang-run**: ghép nhiều đơn cùng giấy, coating, hạn giao lên một tờ in (gợi ý → tự động)
- **Imposition**: dàn trang, dấu cắt, xuất file tờ in
- **Nối với máy in**: agent tại xưởng đẩy file vào hot folder của RIP
- **Năng lực xưởng**: giới hạn đơn giao nhanh mỗi ngày, cảnh báo quá tải
- **Ship từ xưởng**: in nhãn, gửi tracking tự động (cần hãng ship, open issue S1)
- Tồn kho vật tư (tuỳ chọn)

Cần từ bạn: loại máy in và RIP, khổ giấy tờ in, quy trình hiện tại ở xưởng.

## Phase 4: Tăng trưởng và mở rộng

- Sản phẩm mới: flyer, postcard, sticker và label, banner
- Gia công cao cấp: foil, Spot UV, giấy 32pt, sơn cạnh, die-cut
- Editor kéo thả, thêm template, admin sửa layout template
- B2B: card cho cả team từ CSV, tài khoản công ty, giá theo bậc
- Lưu thiết kế, đặt lại một click, sample pack
- Mã giảm giá, landing page theo ngành, SEO, đánh giá thật của khách
- Báo cáo doanh thu, giá vốn, sản phẩm bán chạy

## Chạy song song: chuẩn bị launch

| Việc | Ai làm | Open issue |
|---|---|---|
| Tên thương hiệu, logo, màu sắc, domain | Bạn | U1, I1 |
| Seller's permit California (CDTFA) | Bạn | S5 |
| Terms, Privacy Policy (CCPA), chính sách hoàn tiền | Bạn chuẩn bị nội dung | S9 |
| Chọn hãng thanh toán, ship, dịch vụ thuế | Bạn | S6, S1, S7 |
| Bảng giá thật | Bạn | P1 |
| Accessibility (ADA/WCAG) | Mình | |
| Hạ tầng production: RDS, S3, ElastiCache, backup, giám sát, CI/CD | Mình | I3, I4, I5 |
