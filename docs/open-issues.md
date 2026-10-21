# Vấn đề còn mở

Những điểm còn xung đột, đang dùng tạm, hoặc chưa chốt. **Giải quyết lần lượt sau khi có bản demo** (sau bước 7.5), trừ những mục ghi "Chặn".

Cập nhật: 2026-10-20. Khi giải quyết xong một mục: ghi quyết định vào [decisions.md](decisions.md), cập nhật spec liên quan, rồi chuyển mục đó xuống phần "Đã giải quyết".

| Mức | Ý nghĩa |
|---|---|
| **Chặn** | Phải có câu trả lời trước bước được ghi |
| Cao | Ảnh hưởng tới khách hoặc tiền, nên giải quyết sớm sau demo |
| Thấp | Cải thiện, làm khi có thời gian |

## Hạ tầng & deploy

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| I1 | Domain thật | Demo dùng tạm `<ip>.sslip.io` (decision T13) | Mua domain nào, subdomain gì | Cao (trước khi công khai) |
| I2 | Nơi chạy server | **Đã chốt: AWS EC2** cho demo (decision T13) | Production: EC2 hay ECS | Thấp |
| I3 | Bản demo chạy Postgres/Redis trong container | Chấp nhận cho demo | Production thật chuyển sang RDS/ElastiCache khi nào | Cao |
| I4 | Registry lưu image, CI/CD | Chưa có | ECR hay GHCR; build/deploy tự động bằng gì | Thấp |
| I5 | Quản lý secret ở production (mật khẩu DB, key Stripe, mật khẩu admin đầu tiên) | Dev dùng `.env` | Dùng AWS Secrets Manager / SSM hay biến môi trường của server | Cao |
| I6 | Phiên bản thư viện: đang dùng bản ổn định cũ hơn một major (pnpm 10, NestJS 11, Vite 7, TypeScript 5.9) | Ổn định | Khi nào nâng cấp | Thấp |

## Giá

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| P1 | **Toàn bộ phụ phí là giá tạm**, suy ra từ tỷ lệ của UPrinting/Vistaprint | Seed trong `0003_seed_business_cards_pricing` | Thiết kế lại bảng giá theo giá vốn thật của xưởng (decision B4) | Cao |
| P2 | Phụ phí không có dữ liệu gốc: giao 5 ngày −10%, `uv_both` (+7%, coi như gloss), `uv_front_gloss_back` (+43%) | Số tự đặt | Giá thật | Cao |
| P3 | Hệ số custom size dùng một con số cho mọi mức số lượng; UPrinting thực tế thay đổi 1.6–2.6 lần theo số lượng | Một hệ số | Có tính hệ số theo từng mức số lượng không | Thấp |
| P4 | Trộn hai kiểu tính giá: phụ phí cộng thêm (Vistaprint) cho option, hệ số nhân (UPrinting) cho size | Theo spec mục 4 | Giữ hay thống nhất một kiểu khi thiết kế lại bảng giá | Thấp |
| P5 | Giá hiển thị mặc định là **$39.48** cho 500 card vì mặc định in 2 mặt. Vistaprint quảng cáo $24.99 vì mặc định in 1 mặt. | Mặc định `front_back` | Đổi mặc định sang in 1 mặt để giá "từ" thấp hơn không | Cao |

## Sản phẩm & option

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| O1 | Slim (3.5" × 1.75") không nhập được qua Custom vì cạnh 1.75" nhỏ hơn mức tối thiểu 2" | Chỉ chọn qua option Slim | Có hạ mức tối thiểu Custom xuống 1.75" không | Thấp |
| O2 | Size có sẵn bị xoay dọc (vd. 2" × 3.5"): giữ là Custom nhưng tính giá như size có sẵn | Đã làm trong `packages/pricing` | Xác nhận cách này | Thấp |
| O3 | Rule R7 (in một mặt thì ẩn 2 lựa chọn "UV Front, ... Back") là suy ra từ GotPrint, GotPrint không công bố trực tiếp | Đã seed | Xác nhận với xưởng | Thấp |
| O4 | Ngày lễ: đang seed đủ 11 ngày lễ liên bang, gồm cả Columbus Day và Veterans Day | Seed 2026–2027 | Xưởng có nghỉ những ngày này không; ai nhập ngày lễ cho năm 2028 trở đi | Cao |
| O5 | Template tự thiết kế (bước 7) | Chưa làm | Ai duyệt nội dung và mẫu mã template | Thấp |

## Giao diện (storefront)

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| U1 | **Tên thương hiệu, logo, màu sắc** | Tên tạm **"Print Studio"** (hằng `BRAND_NAME` trong `apps/web/components/site/SiteHeader.tsx`), màu xanh tạm | Tên shop, logo, màu chủ đạo, domain | Cao (nên có trước khi gửi demo) |
| U2 | Option đang là dropdown thường. Vistaprint/MOO dùng ô chọn có ảnh mẫu giấy | Dropdown (theo 48HourPrint) | Có đổi Paper/Coating sang ô có ảnh không (cần ảnh chụp giấy thật) | Thấp |
| U3 | Dropdown số lượng trên điện thoại bị cắt chữ ("· Recommended") | Hiện đủ trên desktop | Rút gọn chữ trên màn hình nhỏ | Thấp |
| U4 | Độ chân thật của preview 3D: vật liệu matte/gloss/UV/soft touch đang chỉnh bằng mắt; UV chỉ thấy vệt bóng rõ khi xoay | Đủ để demo | So với card thật in tại xưởng (chụp ảnh) rồi chỉnh lại thông số vật liệu, ánh sáng | Thấp |
| U5 | Chưa thử thủ công trường hợp máy không có WebGL (code đã có fallback về card 2D) | Có code, chưa test tay | Thử trên máy/trình duyệt cũ | Thấp |
| U11 | Nội dung homepage có vài câu **hứa với khách** cần xác nhận: "Production in as little as 1 business day", "Printed and trimmed in our own facility", "Free proof" (chưa làm luồng proof), "Free shipping over $100" (đang là giá ship mẫu) | Viết theo spec | Xác nhận hoặc sửa câu chữ trước khi công khai | Cao |
| U12 | Homepage và menu có các danh mục **"Coming soon"**: Flyers, Postcards, Stickers & Labels, Signs & Banners | Placeholder | Lộ trình sản phẩm thật sau business card là gì | Thấp |
| U7 | Nội dung khách điền và logo chỉ nằm trên trình duyệt, tải lại trang là mất | Chưa lưu | Lưu nháp (localStorage) hoặc lưu thiết kế vào tài khoản / đơn hàng | Cao |
| U8 | Font: preview dùng font hệ thống (Helvetica/Arial, Georgia). File in sau này cần **nhúng font thật** để giống preview | Font hệ thống | Chọn bộ font có license dùng cho in (vd. Inter, Source Serif), dùng cho cả preview lẫn PDF | Cao (trước khi in thật) |
| U9 | Logo chưa upload lên server, chỉ dùng để xem trước | Chỉ trên trình duyệt | Upload khi khách đặt hàng (dùng `POST /uploads/presign` đã có) | Cao (khi làm đặt hàng) |
| U10 | Admin chưa sửa được layout template (bước 9 chỉ bật/tắt) | Sửa bằng migration | Có cần trình chỉnh template trong admin không | Thấp |
| U6 | Cảnh báo `THREE.Clock deprecated` trong console, đến từ bên trong `@react-three/fiber` | Vô hại | Tự hết khi thư viện cập nhật | Thấp |

## Đặt hàng, ship, thuế (chưa làm trong Phase 1)

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| S1 | Hãng ship và giá ship thật | 3 phương thức mẫu giá cố định | Chọn hãng, lấy giá thật | Cao |
| S2 | Giới hạn dung lượng file PDF upload | Tạm đặt 50 MB (bước 4) | Con số chính thức | Thấp |
| S3 | Giờ chốt đơn tính từ lúc **đã thanh toán và đã duyệt proof** (mình đề xuất) | Ghi trong spec mục 5 | Xác nhận | Cao |
| S4 | Sales tax các bang ngoài California | Chỉ CA | Theo dõi ngưỡng nexus | Thấp |
| S5 | **Seller's permit California (CDTFA)** | Chưa có | Việc pháp lý, bạn tự làm trước khi bán thật | **Chặn bán hàng thật** |

## Bảo mật

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| X1 | API tạo link upload (`POST /uploads/presign`) chưa giới hạn tần suất, ai cũng gọi được | Chưa có rate limit | Thêm rate limit / chỉ cấp link khi có phiên làm việc hợp lệ | Cao |
| X2 | File upload không dùng tới (khách bỏ dở) nằm mãi trong bucket | Chưa dọn | Lifecycle rule tự xoá sau N ngày | Thấp |
| X3 | API chưa giới hạn tần suất cho `POST /quotes` và `GET /configurator` | Không giới hạn | Thêm rate limit chung cho API công khai | Thấp |

## Dữ liệu & migration

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| D2 | `GET /configurator` đọc DB mỗi lần gọi (6 truy vấn nhỏ), chưa có cache | Đủ nhanh cho demo | Thêm cache (xoá khi admin sửa cấu hình) khi lượng truy cập tăng | Thấp |
| D1 | Data migration "không sửa sau khi chạy" | Chưa có môi trường dùng chung nào | Trước lần deploy production đầu tiên có thể gộp/sửa các migration seed; sau đó thì không | Thấp |

## Đã giải quyết

_(chưa có)_
