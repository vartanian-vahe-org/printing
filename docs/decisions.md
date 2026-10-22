# Các quyết định đã chốt

Cập nhật lần cuối: 2026-10-19

## Kinh doanh

| # | Quyết định | Lý do |
|---|---|---|
| B1 | Thị trường: **Mỹ** | |
| B2 | **Tự in tại xưởng riêng**, không dùng nhà in sỉ (4over, SinaLite...) | Chủ động chất lượng, giá vốn và thời gian giao |
| B3 | Sản phẩm đầu tiên: **business card** | Chuẩn hoá cao, khách đặt lại nhiều, rất hợp gang-run |
| B4 | Giá: **theo kiểu Vistaprint** ở giai đoạn đầu (giá gốc theo số lượng + phụ phí từng option). Riêng size dùng **hệ số nhân kiểu UPrinting**. Sẽ thiết kế lại sau. | |
| B5 | Xưởng đặt ở **California**. Giờ chốt đơn **2:00 PM Pacific Time, Thứ Hai – Thứ Sáu**, trừ ngày lễ liên bang | |
| B6 | Sales tax: thu cho **California** trước, dùng Stripe Tax. Bang khác khi vượt ngưỡng nexus | Xưởng ở CA |
| B7 | **Guest checkout**: đặt hàng không cần tài khoản | Giống Vistaprint, UPrinting |
| B8 | Ship: chưa chốt hãng, MVP dùng **phương thức ship mẫu giá cố định**, miễn phí Standard cho đơn từ $100 | |
| B9 | Sample pack: **để sau** | |
| B10 | **Quyền nhân viên xưởng** (vai trò `staff`): xem mọi thứ; với đơn hàng được chuyển "Đang in", nhập tracking, đánh dấu đã giao, ghi chú, gửi lại email. **Không** được ghi nhận thanh toán, huỷ đơn, hoàn tiền, sửa sản phẩm/giá. Owner/admin làm được tất cả | Chốt 2026-10-21 (open issue A6), xem lại khi triển khai thật |
| B11 | **Tài khoản và cài đặt admin** (bước 11): chỉ **owner** quản lý tài khoản nhân viên; owner/admin sửa cài đặt (tên shop, email, giờ chốt, ngày làm việc, ngày lễ) và xem nhật ký; luôn giữ ít nhất 1 owner đang hoạt động; khoá tài khoản, đổi vai trò, đặt lại mật khẩu thì người đó bị đăng xuất ngay; mật khẩu tối thiểu 12 ký tự | Chốt 2026-10-21 |
| B12 | **Tài khoản khách** (bước 10): không bắt buộc, khách vẫn đặt hàng không cần tài khoản. Đơn cũ cùng email chỉ gắn vào tài khoản sau khi **xác thực email** (link 72 giờ; link đặt lại mật khẩu cũng tính là đã xác thực). Đơn đặt khi đã đăng nhập thuộc tài khoản ngay. Giỏ hàng đi theo tài khoản (gộp khi đăng nhập). Mật khẩu khách tối thiểu 10 ký tự | Chốt 2026-10-21 |
| B13 | **Bảo mật admin**: xác thực 2 lớp (app Authenticator) **tự chọn** cho từng người (nên bật cho owner/admin), owner tắt được cho người mất điện thoại; quên mật khẩu admin qua link email 30 phút. Giới hạn chung 300 request/phút mỗi IP công khai cho API đọc catalog và báo giá. Dọn dữ liệu hằng ngày: giỏ quá 30 ngày, file upload không dùng quá 30 ngày | Chốt 2026-10-21 (làm các mục A4, A7, A8, X3, S11, X2) |

## Kiến trúc & stack

| # | Quyết định | Lý do |
|---|---|---|
| T1 | **Tự viết toàn bộ code của site**, không dùng commerce framework hay template (Medusa, Shopify...) | Muốn custom mọi thứ |
| T2 | Dịch vụ bên ngoài (Stripe, AWS...) **dùng trực tiếp SDK của nhà cung cấp**, không bọc thêm lớp interface/adapter | Không có nhu cầu thay nhà cung cấp |
| T3 | Monorepo: **pnpm + Turborepo** | Chia sẻ types, pricing engine giữa các app |
| T4 | Storefront: **Next.js (App Router) + TypeScript** | SEO |
| T5 | Admin + app xưởng: **React + Vite** (SPA/PWA) | Trang nội bộ, không cần SEO |
| T6 | API: **NestJS + Express** (adapter mặc định) | Phổ biến, nhiều tài liệu, dễ custom. Không dùng Fastify. |
| T7 | DB: **PostgreSQL + Drizzle ORM** | Gần SQL, kiểm soát migration |
| T8 | Queue: **Redis + BullMQ** | Preflight, imposition, email, webhook |
| T9 | Prepress worker: **Python** với **pikepdf** (đọc font, ảnh, nét vẽ), **pypdfium2** (render proof), **Pillow** (vẽ đường cắt, vùng an toàn); nhận việc qua BullMQ (gói `bullmq` cho Python). Không dùng PyMuPDF vì license AGPL | Cập nhật 2026-10-21 (bước 8) |
| T10 | Auth: **tự viết** (session trong DB, cookie httpOnly, argon2, RBAC) | |
| T11 | Thanh toán & thuế: ~~Stripe + Stripe Tax~~ **chưa chốt hãng** (xem T14). Lưu file: **AWS S3**. Ship: **chưa chốt hãng** (xem T14). Email: SES/Resend/Postmark. | Cập nhật 2026-10-21 |
| T12 | **Dựng toàn bộ bằng Docker**: môi trường dev chạy bằng Docker Compose, mỗi app có Dockerfile riêng để build image deploy. Chi tiết: [specs/docker.md](specs/docker.md) | Môi trường giống nhau giữa các máy và giữa dev với production |
| T13 | Demo chạy trên **AWS EC2** (1 server, Docker Compose, Caddy HTTPS + mật khẩu). Chưa có domain nên dùng tạm **sslip.io** theo IP. Hướng dẫn: [deploy/README.md](../deploy/README.md) | Chốt ngày 2026-10-20 |
| T14 | **Thanh toán, ship, sales tax** đi qua một "cổng" (interface) nhỏ vì chưa chọn hãng. Bản mặc định: thanh toán thủ công (admin bấm "Đã thanh toán"), bảng phí ship cố định + nhập mã tracking tay, bảng thuế suất theo bang. Chọn hãng xong chỉ cần thêm phần cắm, không sửa giỏ hàng/checkout/đơn hàng. Chỉ áp dụng cho 3 phần này; các dịch vụ khác vẫn theo T2. | Chốt 2026-10-21 |
| T15 | **Email gửi qua SMTP** (thư viện nodemailer), không viết riêng cho từng hãng: SES, Postmark, Resend đều có SMTP, đổi hãng chỉ đổi biến môi trường `SMTP_*`. Local dùng Mailpit. Email đơn hàng đi qua **hàng đợi BullMQ** (T8): SMTP chậm hay lỗi không làm hỏng checkout, tự gửi lại tối đa 5 lần. **Link xem đơn** tạo bằng HMAC từ id đơn + `ORDER_LINK_SECRET`, nên gửi lại link được ("Find my order") mà DB chỉ lưu hash | Chốt 2026-10-21 |
| T16 | **File in và font** (Phase 2 bước 7): font template là **Inter** (sans) và **Lora** (serif), license SIL OFL, lấy từ gói npm `@expo-google-fonts/*`. Preview trên web và file in dùng **cùng file font**, cùng bước dàn trang (`layoutFace` trong `@printing/templates`); web vẽ bằng canvas, server vẽ PDF bằng **pdf-lib** (nhúng nguyên font vì subset của pdf-lib làm mất chữ), logo đổi sang PNG bằng **sharp**. PDF: 1 trang mỗi mặt in, khổ = bleed, có TrimBox/BleedBox, màu RGB. Thông số in (kích thước, mặt sau, layout template) được **chốt vào đơn lúc đặt** (`order_items.print_spec`) | Chốt 2026-10-21 (giải quyết U8) |
| T17 | **Deploy tách**: storefront và admin là **2 project Vercel** riêng (Root Directory `apps/web`, `apps/admin`), EC2 chỉ chạy backend (API, worker, DB, storage, mail). Mỗi site có **proxy `/api` cùng domain** (gói `@printing/api-proxy`) chuyển tiếp tới API, để cookie (giỏ hàng, đăng nhập) là cookie của chính site, không bị chặn như cookie khác domain. Proxy gửi IP khách kèm `API_PROXY_SECRET`; API chỉ tin IP đó khi secret khớp (rate limit theo từng khách). Upload file vẫn đi thẳng lên storage (presigned). Vẫn giữ được kiểu chạy tất cả trên EC2 (Compose profile `sites`). Hướng dẫn: [deploy/VERCEL.md](../deploy/VERCEL.md) | Chốt 2026-10-22 |

## Sản phẩm & UX

| # | Quyết định | Lý do |
|---|---|---|
| P1 | Cấu trúc option theo kiểu **nhà in (48HourPrint/UPrinting)**: Paper và Coating tách riêng, mỗi coating khai báo mặt trước + mặt sau, admin chọn coating cho từng loại giấy | Linh hoạt nhất, bao được cả cách làm của Vistaprint/MOO |
| P2 | Hiển thị theo kiểu **thương hiệu (Vistaprint/MOO)**: tên giấy dễ hiểu + thông số, gom nhóm | Dễ hiểu cho khách lẻ |
| P3 | MVP chỉ làm **phần lõi chung** của các site. Foil, Spot UV, 32pt, editor kéo thả để sau. | |
| P4 | Option không hợp lệ (do ràng buộc) thì **ẩn đi**, không hiển thị "Incompatible" | Theo cách UPrinting/48HourPrint |
| P5 | **Không hard-code giá trị mặc định trong code.** Toàn bộ cấu hình mặc định (paper, coating, ràng buộc, giá) nằm trong **migration/seed**, để admin mở trang setup là thấy và sửa được ngay | Admin là nơi duy nhất quản lý cấu hình |
| P6 | Clone theo **dữ liệu thật của các site lớn**, không tự nghĩ ra option | Giảm rủi ro thiết kế sai so với thói quen khách Mỹ |
| P7 | Có **Custom Size**: 2"–4", bước 0.25" (clone UPrinting) | |
| P8 | MVP nhận thiết kế bằng **upload PDF + preflight tự động + duyệt proof**. Template và editor để sau. | |
| P9 | Proof: không cảnh báo thì Approve ngay; có cảnh báo thì phải xác nhận; có lỗi thì bắt upload lại. Chỉ sản xuất khi đã thanh toán và đã duyệt proof. | |
| P10 | Mặt sau trống thì **không phủ UV mặt sau** (theo GotPrint) | |
| P11 | **Chia giai đoạn.** Phase 1 chỉ làm: homepage chọn option + xem giá, điền nội dung vào template **hoặc** upload PDF, **preview 3D xoay 360°**, admin cơ bản. Thanh toán, đơn hàng, ship, thuế, proof, sản xuất làm sau. Chi tiết: [plan/phase-1.md](plan/phase-1.md) | Ra được sản phẩm xem được sớm |
| P12 | Template lưu dạng **JSON trong DB**, render bằng **một bộ render dùng chung** (JSON → SVG cho preview, sau này → PDF in) | Preview và file in luôn giống nhau |
| P13 | Preview 3D bằng **Three.js** (`@react-three/fiber`): đúng kích thước, độ dày giấy, kiểu góc, vật liệu theo coating từng mặt | |
