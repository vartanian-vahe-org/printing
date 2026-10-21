# Phase 1: Configurator + Preview 3D

Trạng thái: **Draft**, chờ duyệt
Cập nhật: 2026-10-19
Spec liên quan: [specs/business-card-mvp.md](../specs/business-card-mvp.md), [specs/docker.md](../specs/docker.md)

## 1. Mục tiêu

Khách vào **homepage**:
1. Chọn option business card (size, paper, coating, mặt in, góc, số lượng, thời gian in), thấy **giá** cập nhật ngay.
2. Đưa nội dung lên card bằng một trong hai cách:
   - **Điền nội dung vào template** (tên, chức danh, công ty, số điện thoại...), hoặc
   - **Upload file PDF** đã thiết kế sẵn.
3. Xem **preview 3D xoay 360°** của card: đúng kích thước, độ dày giấy, kiểu góc, bề mặt coating, nội dung 2 mặt.

Admin có trang cơ bản để xem và sửa cấu hình.

## 2. Phạm vi

| Có trong Phase 1 | Để giai đoạn sau |
|---|---|
| Monorepo + Docker Compose | Giỏ hàng, checkout, thanh toán (Stripe) |
| DB schema + migration seed theo spec (mục 9, 10) | Sales tax, ship, ngày giao dự kiến trên trang |
| Configurator trên homepage, ẩn option không hợp lệ | Đơn hàng, tài khoản khách, guest checkout |
| Tính giá theo spec mục 4, hiển thị giá | Preflight đầy đủ, duyệt proof |
| Điền nội dung vào template | Sản xuất, phiếu job, app xưởng |
| Upload PDF, hiển thị lên mặt card | Xuất file in (PDF/X, CMYK) từ template |
| Preview 3D xoay 360° | Lưu thiết kế vào tài khoản |
| Admin cơ bản (có đăng nhập) | Editor kéo thả, sample pack |

Bảng cài đặt giờ chốt đơn, ngày lễ và phương thức ship vẫn được tạo và seed như spec, để sau này dùng tới không phải làm lại DB. Phase 1 chỉ chưa có giao diện dùng chúng.

## 3. Trang business card (`/business-cards`)

Bố cục kiểu "design studio" (đổi ngày 2026-10-20 để khách không phải cuộn trang mới tới chỗ điền thông tin):

```
≥ 1280px: 3 cột vừa khít màn hình, mỗi cột bên hông tự cuộn riêng
┌──────────────┬─────────────────────────────┬────────────────┐
│ Options      │                             │ Your design    │
│  Size        │      Preview 3D (360°)      │  Template      │
│  Paper       │      Front / Back           │  Logo          │
│  Coating ... │                             │  Full name ... │
│──────────────│                             │                │
│ $39.48 (ghim)│                             │                │
└──────────────┴─────────────────────────────┴────────────────┘

900–1279px: preview bên trái, bên phải là tab [Options | Design] + tổng giá
< 900px:    preview ở trên, tab và nội dung bên dưới, thanh giá dính ở đáy màn hình
```

- Đổi option nào thì preview và giá cập nhật ngay, không tải lại trang.
- Custom Size: chọn Width × Height (2"–4", bước 0.25") ngay dưới dropdown Size.
- Homepage riêng ở `/` (bước 7.1).

## 4. Điền nội dung vào template

### 4.1 Trường nội dung

| Mặt | Trường |
|---|---|
| Trước | Họ tên, Chức danh, Tên công ty, Số điện thoại, Email, Website, Địa chỉ, Logo (upload ảnh) |
| Sau | Logo, Tên công ty, Slogan (tagline) |

Mặt sau chỉ hiện khi Printed Side = `front_back`. Chọn `same_both` thì mặt sau dùng lại mặt trước.

### 4.2 Template

- Phase 1 có khoảng **4–6 template tự thiết kế** (không sao chép mẫu của Vistaprint hay MOO vì vướng bản quyền).
- Mỗi template là **dữ liệu JSON lưu trong DB** (seed bằng migration), không hard-code trong code.
- Bố cục tính bằng **inch theo trim**, có bleed và safe zone, gồm: vị trí và kích thước từng trường, font, cỡ chữ, màu, căn lề, nền.
- Template co giãn theo size được chọn (Standard, Square, Slim, Custom). Mỗi template khai báo hỗ trợ những size nào.
- **Một bộ render dùng chung**: JSON → SVG. Phase 1 dùng SVG làm texture cho preview. Giai đoạn sau dùng chính bộ render này để xuất PDF in, nên **preview và file in luôn giống nhau**.

## 5. Upload PDF

- Kéo thả hoặc chọn file PDF cho mặt trước, và mặt sau nếu cần.
- Upload lên S3 (dev: RustFS) bằng presigned URL.
- Trình duyệt dùng **pdf.js** render trang đầu của PDF thành ảnh, rồi dùng làm texture cho preview 3D.
- **Kiểm tra cơ bản** (chưa phải preflight đầy đủ):
  - Đúng định dạng PDF
  - Kích thước trang khớp file có bleed hoặc khớp trim (sai số cho phép). Không khớp thì báo lỗi.
  - Số trang khớp với Printed Side
- Thiếu bleed thì vẫn cho xem nhưng hiện cảnh báo.

## 6. Preview 3D

**Công nghệ:** Three.js qua `@react-three/fiber` và `@react-three/drei` (OrbitControls).

| Thuộc tính card | Lấy từ | Cách thể hiện |
|---|---|---|
| Kích thước | Size (gồm Custom) | Đúng tỷ lệ W × H theo inch |
| Độ dày | Paper `thickness_pt` | 1pt = 0.001" (14pt = 0.014"). Phóng nhẹ cho dễ thấy khi xoay. |
| Góc | Corners | Vuông, hoặc bo bán kính 1/4" |
| Bề mặt | Coating `front` / `back` | Vật liệu PBR riêng cho từng mặt (bảng dưới) |
| Nội dung | Template hoặc PDF | Texture mặt trước / mặt sau |
| Mặt sau trống | Printed Side = `front_only` | Mặt sau trắng, theo bề mặt coating mặt sau |

**Vật liệu theo bề mặt** (giá trị khởi đầu, chỉnh khi xem thực tế):

| Bề mặt | Cách thể hiện |
|---|---|
| `matte` | Độ nhám cao, gần như không phản chiếu |
| `gloss` | Độ nhám thấp, phản chiếu nhẹ |
| `uv` | Lớp phủ bóng mạnh (clearcoat), phản chiếu rõ |
| `soft_touch` | Rất nhám, có ánh nhung (sheen) |
| `silk` | Bóng vừa |
| `none` (uncoated) | Rất nhám, có vân giấy mịn |

**Tương tác:**
- Tự xoay chậm khi mới mở trang, dừng khi khách kéo.
- Kéo để xoay 360°, cuộn để phóng to/thu nhỏ (có giới hạn).
- Nút **Mặt trước / Mặt sau** để lật nhanh.
- Ánh sáng đặt sao cho khi xoay thấy được khác biệt giữa matte, gloss và UV.

Hiệu năng: chỉ render lại khi có thay đổi. Máy yếu hoặc không hỗ trợ WebGL thì hiện ảnh phẳng 2 mặt thay thế.

## 7. Admin cơ bản

| Màn hình | Chức năng |
|---|---|
| Đăng nhập | Email + mật khẩu. Tài khoản admin đầu tiên tạo từ biến môi trường khi chạy seed. |
| Option groups & values | Xem, sửa label, thứ tự, mặc định, ẩn/hiện, attributes (kích thước, độ dày, front/back của coating...) |
| Paper detail | Tab "Coatings available", tab "Turnaround available" |
| Coating detail | Tab "Turnaround available" |
| Rules | Xem toàn bộ ràng buộc dạng bảng |
| Pricing | Sửa giá gốc theo số lượng, ma trận phụ phí, hệ số size |
| Templates | Xem danh sách template, bật/tắt. Sửa bố cục để giai đoạn sau. |

Thay đổi trong admin hiện ngay trên homepage.

## 8. Thứ tự làm

| Bước | Việc | Kết quả kiểm tra được |
|---|---|---|
| 1 ✅ | Monorepo (pnpm + Turborepo) + Docker Compose (postgres, redis, RustFS, mailpit) | `docker compose up` chạy được |
| 2 ✅ | Schema + 6 file migration seed + tài khoản admin (seed template chuyển sang bước 7) | Mở DB thấy đủ dữ liệu mặc định |
| 3 ✅ | `packages/pricing`: kiểm tra rule, tính giá, hệ số size | Unit test khớp các ví dụ trong spec |
| 4 ✅ | API: `GET /configurator`, `POST /quotes`, presigned upload | Gọi API ra đúng option, rule, giá |
| 5 ✅ | Homepage: configurator + giá | Chọn option, option không hợp lệ bị ẩn, giá đúng |
| 6 ✅ | Preview 3D: kích thước, độ dày, góc, vật liệu | Đổi option thì card 3D đổi theo |
| 7 ✅ | Template: định dạng layout JSON + bộ render JSON → SVG + migration seed 4–6 template + form điền nội dung | Nội dung hiện lên card 3D |
| 7.1 ✅ | **Homepage** (`/`): hero, ưu điểm, danh mục, template, loại giấy, CTA. Configurator chuyển sang `/business-cards`. Header/footer dùng chung. | Homepage → bấm nút sang trang business card |
| **7.5** | **Deploy demo** (AWS EC2 + sslip.io, file sẵn trong `deploy/`, đã chạy thử trên máy, chờ server): 1 server chạy Docker Compose bằng image production, Caddy (HTTPS), basic auth | Khách vào link demo, nhập mật khẩu, xem được |
| 8 | Upload PDF + pdf.js + kiểm tra cơ bản | PDF hiện lên card 3D |
| 9 | Admin cơ bản | Sửa trong admin, homepage đổi theo |

Mỗi bước xong là chạy được và kiểm tra được, không dồn tới cuối mới chạy.

**Mốc demo cho khách:** sau bước 7 (khách điền tên, công ty lên template và xem card 3D). Có thể demo sớm hơn sau bước 6 với thiết kế mẫu có sẵn.

**Deploy demo (bước 7.5):** riêng bản demo cho Postgres và Redis chạy trong container cho nhanh và rẻ. Production thật vẫn dùng RDS/ElastiCache như [specs/docker.md](../specs/docker.md). Đã chốt: AWS EC2, dùng tạm sslip.io (decision T13). Hướng dẫn: [deploy/README.md](../deploy/README.md).
