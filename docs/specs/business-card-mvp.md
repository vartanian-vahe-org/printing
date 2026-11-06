# Spec MVP: Business Card

Trạng thái: **Draft v2**, chờ duyệt trước khi code
Cập nhật: 2026-10-19
Dựa trên: [research/02-business-card-competitors.md](../research/02-business-card-competitors.md), [decisions.md](../decisions.md)

---

## 1. Phạm vi

**Có trong MVP:**
- Sản phẩm `business-cards` với 7 nhóm option: Size, Paper, Coating, Printed Side, Corners, Quantity, Turnaround
- Ràng buộc giữa các option, option không hợp lệ bị ẩn
- Tính giá: kiểu Vistaprint cho option, kiểu UPrinting cho size
- Đặt hàng không cần tài khoản (guest checkout)
- Khách upload PDF → preflight tự động → duyệt proof
- Tính ngày giao theo giờ chốt đơn 2pm Pacific Time
- Ship: phương thức mẫu với giá cố định (chưa chốt hãng)
- Sales tax: California
- Admin xem và sửa toàn bộ cấu hình; dữ liệu mặc định nạp bằng migration

**Chưa làm:** Foil, Spot UV, Raised, giấy 32pt, sơn cạnh, die-cut, Printfinity, shrink wrap, sample pack, template điền thông tin, editor kéo thả, tích hợp hãng ship thật.

---

## 2. Option và giá trị mặc định

Mọi sản phẩm có 3 **option gốc** làm nên sản phẩm, theo thứ tự: **Size → Paper → Printed Side**. Các option còn lại là **add-on**: Coating, Corners, Turnaround. Add-on có thể phụ thuộc option gốc qua rule (mục 3). Storefront chia thành 2 khối "Your card" và "Add-ons".

### 2.1 Size

| code | Label | Trim | File có bleed | Safe zone |
|---|---|---|---|---|
| `std_3_5x2` (mặc định) | Standard 3.5" × 2" | 3.5" × 2" | 3.75" × 2.25" | 3.25" × 1.75" |
| `square_2_5` | Square 2.5" × 2.5" | 2.5" × 2.5" | 2.75" × 2.75" | 2.25" × 2.25" |
| `slim_3_5x1_75` | Slim 3.5" × 1.75" | 3.5" × 1.75" | 3.75" × 2.0" | 3.25" × 1.5" |

Bleed 0.125"/cạnh, safe zone lùi vào 0.125" tính từ đường cắt (chuẩn của UPrinting, PrintPlace, FedEx Office).

Không có Custom Size: kích thước khách tự nhập không có giá cố định. Cần size mới thì admin thêm thành một option.

### 2.2 Paper

| code | Label hiển thị | Độ dày | Nhóm |
|---|---|---|---|
| `14pt` (mặc định) | Standard – 14pt Cardstock | 14pt | standard |
| `16pt` | Premium – 16pt Cardstock | 16pt | premium |
| `17pt_uncoated` | Premium Uncoated – 17pt Cardstock | 17pt | premium |

### 2.3 Coating

Mỗi coating khai báo bề mặt **mặt trước** và **mặt sau**.

| code | Label | Front | Back |
|---|---|---|---|
| `matte_both` (mặc định) | Matte Both Sides | matte | matte |
| `gloss_both` | Gloss Both Sides | gloss | gloss |
| `uncoated_both` | Uncoated Both Sides | none | none |
| `uv_both` | High Gloss UV Both Sides | uv | uv |
| `uv_front_uncoated_back` | High Gloss UV Front, Uncoated Back | uv | none |
| `uv_front_gloss_back` | High Gloss UV Front, Gloss Back | uv | gloss |
| `soft_touch_both` | Soft Touch (Laminated) | soft_touch | soft_touch |
| `silk_both` | Silk (Laminated) | silk | silk |

### 2.4 Printed Side

| code | Label |
|---|---|
| `front_back` (mặc định) | Front and Back |
| `front_only` | Front Only, Blank Back |
| `same_both` | Same Artwork Both Sides |

### 2.5 Corners

| code | Label |
|---|---|
| `square` (mặc định) | Standard (Square) |
| `rounded_quarter` | Rounded 1/4" |

### 2.6 Quantity

50 · 100 · 250 · **500 (mặc định, Recommended)** · 1,000 · 2,500 · 5,000 · 10,000

Lấy từ bảng giá thật của Vistaprint (bỏ bớt mức 1,500 và 2,000).

Admin thêm, sửa số, ẩn, đặt mặc định và xóa số lượng ở tab Quantity của trang Options. Số lượng mới lấy turnaround của mức gần nhất và chưa có giá, nên khách chưa thấy cho đến khi admin nhập giá ở trang Pricing. Danh sách luôn xếp từ nhỏ đến lớn.

### 2.7 Turnaround

Mỗi sản phẩm có các mức tốc độ và một bảng **Số lượng × Tốc độ** (`turnaround_options`). Mỗi ô gồm số ngày sản xuất và % cộng vào giá in (giá gốc + option, đã nhân hệ số size); % âm là giảm giá. Ô trống nghĩa là không bán mức đó ở số lượng đó. Admin sửa ở trang Turnaround. Số liệu dưới đây là số tạm (open issue P7):

| code | Label | Đến 1,000 | 2,500–5,000 | 10,000 | % |
|---|---|---|---|---|---|
| `economy` | Economy | 5 ngày | 6 ngày | 7 ngày | −10% |
| `standard` (mặc định) | Standard | 3 ngày | 4 ngày | 5 ngày | 0% |
| `express` | Express | 2 ngày | 3 ngày | 4 ngày | +30% |
| `rush` | Rush | 1 ngày | 2 ngày | không bán | +80% |

Turnaround là thời gian **sản xuất**, chưa tính thời gian ship. Cách tính ngày ở mục 5.

---

## 3. Ràng buộc (seed)

| # | Khi chọn | Thì nhóm | Chỉ cho phép | Nguồn |
|---|---|---|---|---|
| R1 | Paper = `14pt` | Coating | matte_both, gloss_both, uncoated_both, uv_both, uv_front_uncoated_back, uv_front_gloss_back | 48HourPrint |
| R2 | Paper = `16pt` | Coating | matte_both, gloss_both, soft_touch_both, silk_both | 48HourPrint + UPrinting (laminated) |
| R3 | Paper = `17pt_uncoated` | Coating | uncoated_both | 48HourPrint, UPrinting |
| R4 | Paper = `17pt_uncoated` | Turnaround | 5d, 3d, 2d | 48HourPrint, UPrinting |
| R5 | Coating = `uv_front_uncoated_back` | Turnaround | 5d, 3d, 2d | 48HourPrint, UPrinting |
| R6 | Coating = `uncoated_both` | Turnaround | 5d, 3d, 2d | UPrinting |
| R7 | Printed Side = `front_only` | Coating | matte_both, gloss_both, uncoated_both, uv_both, soft_touch_both, silk_both | Suy ra từ GotPrint (xem 3.1) |

**Cách áp dụng:**
- Nhiều rule cùng nhắm vào một nhóm thì lấy **giao** của các tập cho phép.
- Option không hợp lệ bị **ẩn** (decision P4).
- Khi khách đổi option làm giá trị đang chọn ở nhóm khác trở nên không hợp lệ: tự chọn lại giá trị mặc định của nhóm đó nếu còn hợp lệ, không thì chọn giá trị hợp lệ đầu tiên theo `sort_order`.
- Server **luôn kiểm tra lại** cấu hình khi báo giá, thêm vào giỏ và đặt hàng. Không tin dữ liệu từ client.

### 3.1 Mặt sau trống thì không phủ UV mặt sau (theo GotPrint)

GotPrint: UV chỉ phủ lên những mặt có in màu. Mặt sau để trống thì mặt sau không phủ UV.

Áp dụng:
- Printed Side = `front_only` và coating có mặt sau là `uv` → **phiếu sản xuất và proof ghi mặt sau = none**. Giá không đổi.
- Hệ quả: khi in một mặt, `uv_both`, `uv_front_uncoated_back` và `uv_front_gloss_back` cho ra cùng một kết quả ở mặt trước. Vì vậy **R7 ẩn 2 lựa chọn "UV Front, ... Back"**, chỉ giữ `uv_both`, để khách không trả thêm tiền cho một mặt sau không được in.
- Coating gloss, matte, soft touch, silk vẫn phủ cả 2 mặt như bình thường (lớp phủ và cán màng phải cân 2 mặt để card không bị cong).

R7 là phần mình suy ra từ quy tắc của GotPrint, GotPrint không công bố trực tiếp.

---

## 4. Tính giá

```
giá in   = core_price[size, paper, printed side, số lượng] + Σ core_price × addon_percent
tổng     = giá in + giá in × turnaround_percent[tốc độ, số lượng]
```

- **Option gốc (Size, Paper, Printed Side):** mỗi tổ hợp có **giá cố định theo từng số lượng** do admin nhập (bảng `core_prices`), không cộng dồn, không có hệ số size. Ô trống nghĩa là tổ hợp đó không bán ở số lượng đó, nên mỗi giấy có thể có bộ số lượng riêng.
- **Thu hẹp lựa chọn:** Size trước, rồi Paper, rồi Printed Side. Mỗi nhóm chỉ hiện giá trị có giá với các option gốc phía trước. Đổi option gốc mà số lượng đang chọn không bán thì tự chuyển sang số lượng gần nhất và báo cho khách.
- **Add-on (Coating, Corners):** một % của giá option gốc, giống nhau ở mọi số lượng (`option_values.addon_percent`). Có thể âm.
- **Turnaround:** bảng Số lượng × Tốc độ (mục 2.7), % tính trên giá in.
- Tiền lưu bằng **số nguyên cent**. Mỗi phần làm tròn tới cent.

### 4.1 Giá seed (giá tạm)

> **Đây là giá tạm** để admin có dữ liệu khởi đầu (open issue P8). Migration `0027` lấy giá của công thức cũ cho từng tổ hợp, nên khách thấy giá gần như không đổi.

Ví dụ 3.5" × 2", 14pt, in 2 mặt: 500 card = $39.48. 1 mặt = $24.99.

| Add-on | % |
|---|---|
| Coating `gloss_both`, `uncoated_both`, `uv_both` | 4 |
| Coating `soft_touch_both`, `silk_both` | 15 |
| Coating `uv_front_uncoated_back`, `uv_front_gloss_back` | 27 |
| Corners `rounded_quarter` | 30 |

---

## 5. Thời gian sản xuất và giờ chốt đơn

| Thiết lập | Giá trị seed |
|---|---|
| Múi giờ | `America/Los_Angeles` (Pacific Time, xưởng ở California) |
| Giờ chốt đơn | **2:00 PM** |
| Ngày làm việc | **Thứ Hai – Thứ Sáu** |
| Ngày nghỉ | Các ngày lễ liên bang Mỹ (seed sẵn năm 2026–2027) |

**Cách tính:**
1. **Ngày bắt đầu** = ngày làm việc mà đơn được tính vào.
   - Đơn **đủ điều kiện sản xuất** (đã thanh toán **và** đã duyệt proof) trước 2:00 PM PT của một ngày làm việc thì tính là ngày đó.
   - Sau 2:00 PM, hoặc rơi vào cuối tuần hay ngày lễ, thì tính sang ngày làm việc kế tiếp.
2. **Ngày xuất xưởng** = ngày bắt đầu + (số ngày turnaround − 1) ngày làm việc. Ví dụ: 1 ngày → xuất xưởng ngay trong ngày bắt đầu.
3. **Ngày nhận dự kiến** = ngày xuất xưởng + thời gian vận chuyển của phương thức ship (mục 7).

Trên trang sản phẩm hiện "Order by 2:00 PM PT to ship by {ngày}" và "Get it by {ngày}", kiểu Vistaprint và Zazzle.

Giờ chốt đơn, ngày làm việc và danh sách ngày lễ đều nằm trong DB, admin sửa được.

---

## 6. Đặt hàng, file in và proof

### 6.1 Guest checkout
- Khách đặt hàng **không cần tài khoản**, chỉ cần email.
- Sau khi đặt xong, gợi ý tạo tài khoản bằng email đó. Đơn cũ tự gắn vào tài khoản.
- Khách guest xem trạng thái đơn bằng link bảo mật gửi qua email.

### 6.2 Upload file
- Nhận **PDF, AI** (lưu có bật "PDF Compatible"), **TIFF, JPG, PSD**, tối đa 200 MB. Không nhận PNG (không chứa được CMYK). EPS chưa nhận (open issue O7).
- Upload thẳng lên S3 bằng presigned URL. Ngay sau khi upload, worker **check file trước khi cho vào giỏ**: đổi ảnh thành PDF đúng size card, cắt bỏ crop marks nếu PDF có khai báo TrimBox, rồi chạy các check ở mục 6.3. File có lỗi thì không vào giỏ được (API chỉ nhận file đã qua check, đúng size card). File thay thế sau khi đặt hàng cũng phải qua check này.
- File nhiều trang: khách chọn trang nào in mặt trước, trang nào in mặt sau (mặc định trang 1 và 2, có nút Swap). File in chỉ giữ các trang đã chọn, đúng thứ tự trước → sau.
- Template tải về (PDF có sẵn bleed và safe zone) cho từng size có sẵn.

### 6.3 Preflight tự động (worker Python)

Áp dụng cho file của khách và file designer giao. File template do hệ thống vẽ thẳng bằng CMYK nên chỉ chạy check size, font và DPI của logo (chỉ cảnh báo).

| Kiểm tra | Kết quả nếu không đạt |
|---|---|
| Đúng loại file (đọc nội dung, không tin đuôi file); ảnh không quá 100 triệu pixel | **Lỗi** |
| PDF có mật khẩu | **Lỗi** |
| Kích thước trang khớp file có bleed (có sai số cho phép); ảnh đúng tỉ lệ card | **Lỗi**: bắt upload lại |
| Kích thước bằng trim, thiếu bleed | **Cảnh báo** |
| Số trang khớp với Printed Side | **Lỗi** |
| Ảnh dưới 300 DPI (sai số 1%) | **Lỗi** |
| Font chưa nhúng | **Lỗi** |
| Có màu RGB hoặc Lab (ảnh, chữ, hình, gradient) | **Lỗi**. Grayscale được chấp nhận |
| Có màu pha (Pantone / spot) | **Lỗi** |
| Chữ nhỏ hơn 6pt | **Cảnh báo** |
| Trang trắng trơn | **Cảnh báo** |
| Chữ hoặc đối tượng nằm ngoài safe zone | **Cảnh báo** |
| Nét mảnh dưới 0.25pt | **Cảnh báo** |

### 6.4 Proof
- Hệ thống tạo ảnh proof cho từng mặt, có vẽ đường cắt, vùng bleed và safe zone.
- **Không có cảnh báo:** khách bấm "Approve" ngay trên web.
- **Có cảnh báo:** khách phải tick xác nhận từng cảnh báo rồi mới Approve được.
- **Có lỗi:** không cho Approve, bắt upload lại.
- Đơn chỉ vào sản xuất khi **đã thanh toán và đã duyệt proof**. Thời điểm duyệt dùng để tính giờ chốt đơn (mục 5).

---

## 7. Ship (mẫu, chưa chốt hãng)

Chưa chốt hãng ship, nên MVP dùng **phương thức ship mẫu với giá cố định**. Lưu trong DB, admin sửa được, sau này thay bằng giá thật của hãng.

| code | Label | Thời gian vận chuyển | Giá (mẫu) |
|---|---|---|---|
| `standard` (mặc định) | Standard Shipping | 3–5 ngày làm việc | $6.99 |
| `expedited` | Expedited Shipping | 2 ngày làm việc | $14.99 |
| `overnight` | Overnight Shipping | 1 ngày làm việc | $29.99 |

- **Miễn phí Standard Shipping cho đơn từ $100**, giống Vistaprint ("free economy shipping on orders $100+").
- Gửi từ xưởng ở California. Giao trong 50 bang + DC, chưa nhận địa chỉ quốc tế và APO/FPO.
- Giá ship là số mẫu, chưa đối chiếu với giá hãng.

## 8. Sales tax

- Xưởng ở **California**, nên bắt buộc thu sales tax cho đơn giao tới California.
- Dùng **Stripe Tax** tính thuế theo địa chỉ giao hàng.
- Các bang khác: chỉ thu khi doanh thu vượt ngưỡng nexus của bang đó. Stripe Tax có theo dõi ngưỡng; khi vượt thì đăng ký thêm bang mới.
- Cần có **seller's permit của California (CDTFA)** trước khi bán. Đây là việc pháp lý, không phải việc code.

---

## 9. Data model

```
products
  id, code ('business-cards'), name, is_active, created_at, updated_at

option_groups
  id, product_id, code ('size'|'paper'|'coating'|'printed_side'|'corners'|'turnaround'),
  label, description, sort_order, display_style ('dropdown'|'radio'|'swatch'),
  is_required, created_at, updated_at
  UNIQUE (product_id, code)

option_values
  id, group_id, code, label, description, sort_order, is_active, is_default,
  attributes JSONB,
    -- size:        {trim_w_in, trim_h_in, bleed_in, safe_in}
    -- paper:       {thickness_pt, tier}
    -- coating:     {front, back, laminated}
    -- printed_side:{back: 'separate' | 'blank' | 'same_as_front'}
    -- corners:     {radius_in}
    -- turnaround:  {} (ngày và % nằm trong turnaround_options)
  addon_percent NUMERIC(6,2) DEFAULT 0,   -- add-on: % của giá option gốc
  created_at, updated_at
  UNIQUE (group_id, code)
  -- mỗi group có đúng 1 value is_default = true (partial unique index)

option_value_rules
  id, product_id,
  when_value_id   → option_values.id
  target_group_id → option_groups.id
  created_at, updated_at
  UNIQUE (when_value_id, target_group_id)

option_value_rule_allowed
  rule_id → option_value_rules.id, value_id → option_values.id
  PRIMARY KEY (rule_id, value_id)

product_quantity_tiers
  id, product_id, quantity, sort_order, is_active, is_default
  UNIQUE (product_id, quantity)

core_prices                              -- không có dòng = không bán
  size_value_id, paper_value_id, printed_side_value_id → option_values.id,
  quantity_tier_id → product_quantity_tiers.id,
  price_cents (> 0)
  PRIMARY KEY (size_value_id, paper_value_id, printed_side_value_id, quantity_tier_id)

production_settings                      -- 1 dòng
  timezone, cutoff_time, working_days (int[] 1–5), updated_at

holidays
  id, date, name
  UNIQUE (date)

shipping_methods
  id, code, label, transit_days_min, transit_days_max, price_cents,
  free_over_cents (nullable), sort_order, is_active, is_default

templates                                -- thiết kế mẫu (Phase 1, bước 7 định nghĩa layout)
  id, product_id, code, name, description, sort_order, is_active,
  supported_size_codes text[], layout JSONB
  UNIQUE (product_id, code)

staff_users                              -- tài khoản admin
  id, email (unique, không phân biệt hoa thường), name, password_hash (argon2id),
  role ('owner'|'admin'|'staff'), is_active, last_login_at
```

Schema thật nằm ở `packages/db/src/schema/`, migration ở `packages/db/migrations/`.

- Quantity không nằm trong `option_groups` vì giá gốc gắn với nó.
- Order item lưu **toàn bộ cấu hình và giá tại thời điểm đặt** (snapshot). Đổi cấu hình hay bảng giá sau đó không ảnh hưởng đơn cũ.
- Mọi bảng cấu hình đều được ghi audit log khi admin sửa.

---

## 10. Migration & seed

**Yêu cầu (decision P5):** không hard-code giá trị mặc định trong code. Admin mở trang setup là thấy ngay cấu hình mặc định ở mọi môi trường, kể cả production.

### 10.1 Ba loại dữ liệu, ba cách nạp

| Loại | Ví dụ | Cách nạp | Chạy ở |
|---|---|---|---|
| **Schema** | Bảng, index, khoá ngoại | Drizzle migration (`drizzle-kit generate`) | Mọi môi trường |
| **Cấu hình mặc định** | Option, rule, giá, giờ chốt đơn, ngày lễ, phương thức ship | **Data migration**: file SQL viết tay trong cùng chuỗi migration (`drizzle-kit generate --custom`) | Mọi môi trường, **đúng 1 lần** |
| **Dữ liệu giả để dev** | Khách, đơn hàng, file mẫu | Script `pnpm db:seed:dev` | Chỉ local/dev, không bao giờ chạy ở production |

### 10.2 Quy tắc cho data migration

1. **Định danh bằng `code`**, không phụ thuộc ID tự tăng. Tham chiếu bằng subquery theo code.
2. **Chỉ chèn nếu chưa có**: `INSERT ... ON CONFLICT DO NOTHING`. Không bao giờ ghi đè dữ liệu admin đã sửa.
3. **Không sửa data migration đã chạy.** Muốn đổi mặc định sau này thì viết migration mới.
4. Ghi `created_by = 'system:migration'` để phân biệt với dữ liệu admin tạo.
5. Mỗi file seed chạy trong **một transaction**: lỗi thì rollback toàn bộ.

### 10.3 Thứ tự file dự kiến

```
packages/db/migrations/
  0000_init_schema.sql                         -- schema mục 9
  0001_seed_business_cards_catalog.sql         -- product, 6 groups, values, mặc định, attributes
  0002_seed_business_cards_rules.sql           -- R1–R7
  0003_seed_business_cards_pricing.sql         -- giá ban đầu, 0026–0028 đổi sang core_prices (mục 4)
  0004_seed_production_settings.sql            -- 2pm PT, Thứ Hai–Thứ Sáu, ngày lễ 2026–2027
  0005_seed_shipping_methods.sql               -- 3 phương thức ship mẫu (mục 7)
```

Phụ phí trong `0003` được tính sẵn ra cent cho từng mức số lượng, để đọc file SQL là biết chính xác giá trị nạp vào.

---

## 11. Màn hình admin (phạm vi MVP)

| Màn hình | Chức năng |
|---|---|
| Product → Option groups | Danh sách nhóm, đổi thứ tự, đổi label, kiểu hiển thị |
| Option library | Kho chung của mọi product, không đổi theo product đang chọn: thêm nhóm và option, sửa tên và thông số (áp dụng cho mọi product đang dùng), xem product nào đang dùng; chỉ xóa được khi không product nào dùng |
| Trang product (`/products/:code`) | Mở từ danh sách Products, tên product ở đầu trang, các tab Options, Prices, Turnaround, Rules, Templates, Design services, Details. Sidebar không có ô chọn product |
| Product → Options | Tick option từ kho chung cho product, chọn mặc định, ẩn/hiện, thêm option mới ngay tại đây. Chỉ lưu khi bấm Save changes |
| Option library → Design services | Gói thiết kế dùng chung: tên chuẩn, giá gợi ý, nội dung, ngày, số lần sửa |
| Product → Design services | Tick gói, đặt tên riêng và giá riêng cho product |
| Option library → Quantity | Thêm, sửa, xóa số lượng dùng chung; sửa số thì áp dụng cho mọi product, giữ nguyên giá |
| Product → Options → Quantity | Tick số lượng từ kho chung, ẩn, đặt mặc định; giá và turnaround riêng từng product |
| Products | Danh sách product; sửa tên, tên đơn vị (flyer/flyers), mô tả, SEO; đổi thứ tự, ẩn/hiện, xóa. Product chưa xong có nút Continue setup |
| Products → New / Setup | Wizard tạo product: Details, Size, Paper, Printed sides, Quantity, Turnaround, Prices, Add-ons (tùy chọn), Review và Publish. Bắt đầu trống hoặc copy từ product có sẵn. Tick và nhập chỉ đổi trên giao diện, bấm Next mới lưu cả bước, chưa đủ thì không qua bước sau được |
| **Paper detail** | Tab "Coatings available" (checkbox), tab "Turnaround available". Lưu vào `option_value_rules`. |
| Coating detail | Tab "Turnaround available" |
| Size detail | Kích thước, bleed, safe zone. |
| Rules | Xem toàn bộ ràng buộc dạng bảng |
| Prices | Chọn Size và Paper bằng tab như trang Options, bảng bên dưới là Printed Side × Quantity, ô trống là không bán, mỗi tab đếm số ô đã có giá. Dưới: % add-on, mỗi nhóm một tab. |
| Production settings | Giờ chốt đơn, ngày làm việc, danh sách ngày lễ |
| Shipping methods | Phương thức, thời gian vận chuyển, giá, ngưỡng miễn phí |
| Preview | Configurator chạy thử với cấu hình hiện tại, hiện giá và ngày giao |

---

## 12. API (phác thảo)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/products/business-cards/configurator` | Groups, values, rules, quantity tiers, giá, cài đặt giờ chốt đơn. Client dùng để render, tính giá và ngày giao ngay. |
| POST | `/quotes` | Nhận cấu hình, server kiểm tra rule, tính giá và ngày giao chính thức |
| POST | `/uploads/presign` | Lấy presigned URL để upload PDF |
| POST | `/order-items/:id/proof/approve` | Khách duyệt proof (kèm xác nhận các cảnh báo) |
| `/admin/...` | CRUD cho các bảng ở mục 9 | Cần quyền `catalog:write` / `settings:write` |

Logic kiểm tra rule, tính giá và tính ngày làm việc viết một lần trong `packages/pricing` (TypeScript thuần), dùng chung cho storefront và API.

---

## 13. Đã chốt / còn mở

**Đã chốt (2026-10-19):**
- [x] Giá seed ở mục 4.1 dùng làm giá tạm
- [x] Số lượng bắt đầu từ 50
- [x] Mặt sau trống thì không phủ UV mặt sau (mục 3.1)
- [x] Giờ chốt đơn 2:00 PM Pacific Time, Thứ Hai – Thứ Sáu
- [x] Sample pack: để sau
- [x] Xưởng ở California
- [x] MVP: upload PDF + preflight + duyệt proof
- [x] Có guest checkout
- [x] Ship: dùng phương thức mẫu, chưa chốt hãng

**Còn mở:**
- [ ] Giá ship thật và hãng ship
- [ ] Giới hạn kích thước file upload
- [ ] Ngưỡng nexus và đăng ký sales tax các bang ngoài California (khi có doanh thu)
