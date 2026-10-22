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
| I7 | Deploy tách Vercel + EC2 (decision T17): preview deployment của Vercel không nằm trong CORS của storage, nên trên preview không upload file được | Chỉ URL production được thêm vào `SITE_URLS` | Có cần preview upload được không (thêm wildcard CORS cho `*.vercel.app` của team, hoặc chỉ dùng production) | Thấp |

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
| O4 | Ngày lễ: đang seed đủ 11 ngày lễ liên bang, gồm cả Columbus Day và Veterans Day | Seed 2026–2027 | Xưởng có nghỉ những ngày này không; ngày lễ 2028 trở đi admin tự thêm ở trang Settings | Cao |
| O5 | Template tự thiết kế (bước 7) | Chưa làm | Ai duyệt nội dung và mẫu mã template | Thấp |
| O6 | File in đang dùng **màu RGB**, chưa đổi sang CMYK hay gắn color profile (GRACoL/SWOP) | RGB; phần mềm RIP của máy in tự đổi. Cảnh báo RGB ở proof đang nói với khách "chúng tôi đổi sang CMYK" | Hỏi xưởng: máy in/RIP nhận RGB được không, hay cần PDF/X với CMYK? Có cần crop marks không? | Trung bình (trước khi in thật) |
| O7 | Kiểm tra file chưa có: chữ quá nhỏ (dưới 6pt), màu đen 4 lớp (rich black) cho chữ nhỏ, tổng mực quá cao | Chỉ các mục trong spec 6.3 | Hỏi xưởng các ngưỡng thường dùng rồi thêm vào `preflight.py` | Thấp |

## Giao diện (storefront)

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| U1 | **Tên thương hiệu, logo, màu sắc** | Tên tạm **"Print Studio"** (hằng `BRAND_NAME` trong `apps/web/components/site/SiteHeader.tsx`), màu xanh tạm | Tên shop, logo, màu chủ đạo, domain | Cao (nên có trước khi gửi demo) |
| U2 | Option đang là dropdown thường. Vistaprint/MOO dùng ô chọn có ảnh mẫu giấy | Dropdown (theo 48HourPrint) | Có đổi Paper/Coating sang ô có ảnh không (cần ảnh chụp giấy thật) | Thấp |
| U4 | Độ chân thật của preview 3D: vật liệu matte/gloss/UV/soft touch đang chỉnh bằng mắt; UV chỉ thấy vệt bóng rõ khi xoay | Đủ để demo | So với card thật in tại xưởng (chụp ảnh) rồi chỉnh lại thông số vật liệu, ánh sáng | Thấp |
| U5 | Chưa thử thủ công trường hợp máy không có WebGL (code đã có fallback về card 2D) | Có code, chưa test tay | Thử trên máy/trình duyệt cũ | Thấp |
| U11 | Nội dung homepage có vài câu **hứa với khách** cần xác nhận: "Production in as little as 1 business day", "Printed and trimmed in our own facility", "Free proof" (luồng proof đã làm ở Phase 2 bước 8), "Free shipping over $100" (đang là giá ship mẫu) | Viết theo spec | Xác nhận hoặc sửa câu chữ trước khi công khai | Cao |
| U12 | Homepage và menu có các danh mục **"Coming soon"**: Flyers, Postcards, Stickers & Labels, Signs & Banners | Placeholder | Lộ trình sản phẩm thật sau business card là gì | Thấp |
| U10 | Admin chưa sửa được layout template (bước 9 chỉ bật/tắt) | Sửa bằng migration | Có cần trình chỉnh template trong admin không | Thấp |
| U16 | Tài khoản khách: chưa đổi được **email** (đổi tên, mật khẩu đã có), chưa có đăng nhập bằng Google/Apple | Đổi email qua hỗ trợ | Đổi email cần xác thực email mới và gắn lại đơn; social login nếu khách cần | Thấp |
| U6 | Cảnh báo `THREE.Clock deprecated` trong console, đến từ bên trong `@react-three/fiber` | Vô hại | Tự hết khi thư viện cập nhật | Thấp |

## Đặt hàng, thanh toán, ship, thuế

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| S6 | **Hãng thanh toán** | Bản mặc định: thanh toán thủ công, admin bấm "Đã thanh toán" (decision T14) | Stripe, Square hay PayPal (đề xuất Stripe). Có tài khoản là mình cắm vào, chạy test mode được ngay | **Cao, chặn bán bằng thẻ** |
| S1 | **Hãng ship** và giá ship thật | Bảng phí cố định (Standard $6.99 / Expedited $14.99 / Overnight $29.99, free từ $100) + nhập mã tracking tay | EasyPost hay Shippo (hay gọi thẳng UPS/USPS); tài khoản hãng | Cao |
| S7 | **Dịch vụ tính sales tax** | Bảng thuế suất theo bang, seed California 7.25% (mức tối thiểu của bang, **chưa gồm thuế quận/thành phố**, tổng thực tế có thể >10%) | Stripe Tax, TaxJar hay Avalara. **Không nên bán thật với bảng tạm** | **Cao, chặn bán thật** |
| S8 | Phí ship có chịu sales tax không (California: thường không, nếu ghi tách riêng và giao bằng hãng vận chuyển) | Bản mặc định: chỉ tính thuế trên tiền hàng | Xác nhận với kế toán, hoặc để dịch vụ tính thuế xử lý | Thấp |
| S2 | Giới hạn dung lượng file PDF upload | Tạm đặt 50 MB | Con số chính thức | Thấp |
| S3 | Giờ chốt đơn tính từ lúc **đã thanh toán và đã duyệt proof** | Ghi trong spec mục 5 | Xác nhận | Cao |
| S4 | Sales tax các bang ngoài California | Chỉ CA | Theo dõi ngưỡng nexus | Thấp |
| S5 | **Seller's permit California (CDTFA)** | Chưa có | Việc pháp lý, bạn tự làm trước khi bán thật | **Chặn bán hàng thật** |
| S9 | Terms of Service, Privacy Policy (CCPA), chính sách hoàn tiền / in lại | Chưa có. Checkout đã có dòng "By placing your order you agree to our Terms of Use and Privacy Policy" nhưng chưa gắn link | Bạn chuẩn bị nội dung (hoặc nhờ luật sư), mình đưa lên web và gắn vào checkout | **Chặn bán hàng thật** |
| S14 | Kiểm tra địa chỉ có thật (USPS / hãng ship) trước khi đặt | Chỉ kiểm tra định dạng: bang, ZIP 5 số, SĐT 10 số | Dùng API kiểm tra địa chỉ của hãng ship khi chọn S1 (EasyPost, Shippo đều có) | Trung bình |
| S15 | **Gửi email thật**: chọn hãng (SES, Postmark hay Resend), xác thực domain (SPF, DKIM, DMARC), đổi địa chỉ thật trong `store_settings` (đang là `support@printing.local`, `orders@printing.local`) | Local và demo dùng Mailpit, không gửi ra ngoài | Cần domain (I1) trước. Đổi hãng chỉ là đổi biến `SMTP_*` (decision T15) | **Cao, chặn bán thật** |
| S18 | Thời gian vận chuyển là con số cố định cho mọi bang (Standard 3–5 ngày…), nên ngày nhận dự kiến chỉ gần đúng. Ví dụ ship từ California đi New York thực tế lâu hơn đi Nevada | Theo bảng `shipping_methods` | Lấy thời gian vận chuyển thật theo ZIP từ hãng ship khi chọn S1 | Trung bình |

## Bảo mật

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| X6 | Giới hạn tần suất (đặt đơn 20/giờ/IP và 10/giờ/email, link upload 60/giờ/IP, đăng nhập khách 20/15 phút/IP) là con số tự đặt, chưa có dữ liệu thật; API tin 1 lớp proxy (`trust proxy 1`) nên khi deploy **bắt buộc** phải có Caddy/ALB đứng trước, nếu không client tự giả IP được | Đã làm | Theo dõi sau khi chạy thật và chỉnh; cân nhắc Cloudflare Turnstile ở checkout nếu vẫn bị spam | Trung bình |

## Admin

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| A3 | Admin chưa **thêm mới** được option, mức số lượng, sản phẩm. Mới chỉ sửa, ẩn/hiện cái đã có | Thêm bằng migration | Có cần thêm mới trong admin không | Thấp |

## Dữ liệu & migration

| # | Vấn đề | Hiện tại | Cần quyết | Mức |
|---|---|---|---|---|
| D1 | Data migration "không sửa sau khi chạy" | Chưa có môi trường dùng chung nào | Trước lần deploy production đầu tiên có thể gộp/sửa các migration seed; sau đó thì không | Thấp |

## Đã giải quyết

_(chưa có)_
