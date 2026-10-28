# Lộ trình

Cập nhật: 2026-10-23

| Phase | Mục tiêu | Mốc khi xong | Trạng thái |
|---|---|---|---|
| **1** | Configurator, giá, template / upload PDF, preview 3D, admin cơ bản | Demo cho khách | ✅ Xong, đang chạy trên staging ([phase-1.md](phase-1.md)) |
| **2** | **Bán được hàng** | Khách đặt và thanh toán. Xưởng in theo đơn (xử lý tay) | ✅ Code xong 11/11 bước ([phase-2.md](phase-2.md)). Chờ chốt hãng và giá thật để mở bán (xem bên dưới) |
| **3** | Tự động hoá xưởng | Đơn chạy từ web tới máy in và ra kho gần như không cần thao tác tay | ⬜ Chưa bắt đầu, cần thông tin xưởng |
| **4** | Tăng trưởng và mở rộng | Thêm sản phẩm, giữ chân khách, công cụ marketing | 🟡 Đã làm sớm vài phần |

## Hiện trạng (2026-10-23)

- **Staging**: storefront và admin trên Vercel, API và worker trên EC2 ([deploy/VERCEL.md](../../deploy/VERCEL.md), decision T17).
- **Đang cho khách xem từng phần**: trên staging đang ẩn đăng nhập và giỏ hàng, flow dừng sau khi chọn option và thiết kế (`apps/web/.env.production`). Admin chỉ hiện phần setup Business Cards; Orders, Settings, Staff, Activity đang ẩn (`apps/admin/.env.production`).
- **Làm thêm ngoài kế hoạch Phase 2**:
  - Trang sản phẩm 3 bước: option → cách thiết kế → chi tiết (decision P14)
  - Bộ lọc template theo ngành, phong cách, màu; admin sửa được
  - Gói **"Let us design it for you"** (Standard / Premium / Elite), giá riêng theo sản phẩm; designer giao proof trong admin, khách yêu cầu sửa theo số lần của gói
  - Proof: template khách tự duyệt trước khi vào giỏ; upload được chọn "gửi proof" hoặc "in luôn" (decision P15)
  - Đăng nhập 2 bước và đặt lại mật khẩu cho nhân viên, rate limit, cache catalog, dọn dữ liệu hằng ngày

## Để mở bán thật (cuối Phase 2)

Code đã có sẵn bản tạm cho từng phần; khi bạn chốt thì chỉ cần thêm phần cắm hoặc đổi dữ liệu.

| Việc | Đang dùng tạm | Ai chốt | Open issue |
|---|---|---|---|
| Hãng thanh toán (thẻ, PayPal, Apple Pay) | Thanh toán thủ công, admin bấm "Đã thanh toán" | Bạn | S6 |
| Hãng ship và in nhãn | Bảng phí cố định, nhập tracking tay | Bạn | S1 |
| Dịch vụ sales tax | Bảng thuế suất theo bang | Bạn | S7 |
| Bảng giá in thật | Giá tạm suy ra từ đối thủ | Bạn | P1, P2 |
| Giá và quyền lợi các gói thiết kế, ai làm designer | $29 / $59 / $99 tạm | Bạn | P6 |
| Nhà cung cấp email (SES, Postmark…) | Mailpit (không gửi ra ngoài) | Bạn + mình | T15 |
| Tên thương hiệu, logo, domain | "Print Studio", sslip.io | Bạn | U1, I1 |
| Hạ tầng production: RDS, S3, ElastiCache, backup, giám sát, CI/CD | Postgres/Redis/storage trong container trên EC2 | Mình | I3, I4, I5 |

## Phase 3: Tự động hoá xưởng

- **Phiếu job**: mỗi sản phẩm trong đơn thành một job, có barcode/QR, trạng thái theo công đoạn
- **App xưởng** (tablet / máy quét): In → Cắt → Gia công → Đóng gói
- **Gang-run**: ghép nhiều đơn cùng giấy, coating, hạn giao lên một tờ in (gợi ý → tự động)
- **Imposition**: dàn trang, dấu cắt, xuất file tờ in
- **Nối với máy in**: agent tại xưởng đẩy file vào hot folder của RIP
- **Năng lực xưởng**: giới hạn đơn giao nhanh mỗi ngày, cảnh báo quá tải
- **Ship từ xưởng**: in nhãn, gửi tracking tự động (cần hãng ship, open issue S1)
- **Màn hình cho designer**: danh sách việc thiết kế, giao việc, chat với khách (open issue U18)
- Tồn kho vật tư (tuỳ chọn)

Cần từ bạn: loại máy in và RIP, khổ giấy tờ in, quy trình hiện tại ở xưởng.

## Phase 4: Tăng trưởng và mở rộng

| Việc | Trạng thái |
|---|---|
| Sản phẩm mới: flyer, postcard, sticker và label, banner | ⬜ |
| Gia công cao cấp: foil, Spot UV, giấy 32pt, sơn cạnh, die-cut | ⬜ |
| Editor kéo thả, admin sửa layout template | ⬜ |
| Thêm template; bộ lọc template | 🟡 Bộ lọc xong (ngành, phong cách, màu); mới có 5 template |
| Dịch vụ thiết kế giúp khách | ✅ Gói Standard / Premium / Elite |
| B2B: card cho cả team từ CSV, tài khoản công ty, giá theo bậc | ⬜ |
| Đặt lại một click | ✅ Trong tài khoản khách |
| Lưu thiết kế vào tài khoản, sample pack | ⬜ (thiết kế dở đang lưu trên trình duyệt) |
| Mã giảm giá, thanh "còn $X được free ship", upsell sau Add to cart | ⬜ (thấy ở Vistaprint, [research/03](../research/03-checkout-flows.md)) |
| Upload sau ("Buy now & upload later"), nhận JPG/PNG, upload từ Dropbox/Google Drive | ⬜ (thấy ở UPrinting, 48HourPrint) |
| Landing page theo ngành, SEO, đánh giá thật của khách | ⬜ |
| Báo cáo doanh thu, giá vốn, sản phẩm bán chạy | ⬜ |

## Chạy song song: chuẩn bị launch

| Việc | Ai làm | Open issue |
|---|---|---|
| Seller's permit California (CDTFA) | Bạn | S5 |
| Terms, Privacy Policy (CCPA), chính sách hoàn tiền | Bạn chuẩn bị nội dung | S9 |
| Accessibility (ADA/WCAG) | Mình | |
