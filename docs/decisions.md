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
| T9 | Prepress worker: **Python** (PyMuPDF, pikepdf, Ghostscript) | Thư viện PDF mạnh |
| T10 | Auth: **tự viết** (session trong DB, cookie httpOnly, argon2, RBAC) | |
| T11 | Thanh toán & thuế: **Stripe + Stripe Tax**. Lưu file: **AWS S3**. Ship: EasyPost/Shippo. Email: SES/Resend/Postmark. | |
| T12 | **Dựng toàn bộ bằng Docker**: môi trường dev chạy bằng Docker Compose, mỗi app có Dockerfile riêng để build image deploy. Chi tiết: [specs/docker.md](specs/docker.md) | Môi trường giống nhau giữa các máy và giữa dev với production |
| T13 | Demo chạy trên **AWS EC2** (1 server, Docker Compose, Caddy HTTPS + mật khẩu). Chưa có domain nên dùng tạm **sslip.io** theo IP. Hướng dẫn: [deploy/README.md](../deploy/README.md) | Chốt ngày 2026-10-20 |

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
