# Spec MVP: Business Card

Trạng thái: **Draft v2**, chờ duyệt trước khi code
Cập nhật: 2026-10-19
Dựa trên: [research/02-business-card-competitors.md](../research/02-business-card-competitors.md), [decisions.md](../decisions.md)

---

## 1. Phạm vi

**Có trong MVP:**
- Sản phẩm `business-cards` với 7 nhóm option: Size (có Custom Size), Paper, Coating, Printed Side, Corners, Quantity, Turnaround
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

Thứ tự hiển thị lấy theo 48HourPrint: Size → Paper → Coating → Printed Side → Corners → Quantity → Turnaround.

### 2.1 Size

| code | Label | Trim | File có bleed | Safe zone |
|---|---|---|---|---|
| `std_3_5x2` (mặc định) | Standard 3.5" × 2" | 3.5" × 2" | 3.75" × 2.25" | 3.25" × 1.75" |
| `square_2_5` | Square 2.5" × 2.5" | 2.5" × 2.5" | 2.75" × 2.75" | 2.25" × 2.25" |
| `slim_3_5x1_75` | Slim 3.5" × 1.75" | 3.5" × 1.75" | 3.75" × 2.0" | 3.25" × 1.5" |
| `custom` | Custom Size | W × H do khách chọn | (W+0.25") × (H+0.25") | (W−0.25") × (H−0.25") |

Bleed 0.125"/cạnh, safe zone lùi vào 0.125" tính từ đường cắt (chuẩn của UPrinting, PrintPlace, FedEx Office).

**Custom Size** (clone UPrinting):
- Width và Height chọn từ **2" đến 4"**, bước **0.25"**.
- Min, max và bước lưu trong `attributes` của value `custom`, admin sửa được.
- Nếu khách chọn **đúng** kích thước một size có sẵn thì hệ thống tự chuyển sang size có sẵn đó (UPrinting làm vậy, giá cũng theo size có sẵn).
- Nếu khách chọn kích thước của một size có sẵn nhưng **xoay ngang/dọc** (vd. 2" × 3.5" dọc) thì giữ là Custom vì hướng card ảnh hưởng thiết kế, nhưng **tính giá như size có sẵn** đó.
- Lưu ý: Slim (3.5" × 1.75") có cạnh 1.75" nhỏ hơn mức tối thiểu 2" của Custom, nên chỉ chọn được qua option Slim, không nhập qua Custom được.
- Kích thước khách chọn được lưu vào order item. Preflight và file in tính theo kích thước đó.

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
| `front_back` (mặc định) | Full Color, Front and Back |
| `front_only` | Full Color Front, Blank Back |
| `same_both` | Full Color, Same Artwork Both Sides |

### 2.5 Corners

| code | Label |
|---|---|
| `square` (mặc định) | Standard (Square) |
| `rounded_quarter` | Rounded 1/4" |

### 2.6 Quantity

50 · 100 · 250 · **500 (mặc định, Recommended)** · 1,000 · 2,500 · 5,000 · 10,000

Lấy từ bảng giá thật của Vistaprint (bỏ bớt mức 1,500 và 2,000).

### 2.7 Turnaround

| code | Label | Số ngày làm việc |
|---|---|---|
| `5d` | 5 Business Days | 5 |
| `3d` (mặc định) | 3 Business Days | 3 |
| `2d` | 2 Business Days | 2 |
| `1d` | 1 Business Day | 1 |

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
giá = (base_price[quantity] + Σ upcharge[option_value][quantity]) × size_multiplier
```

- `base_price` là giá của **cấu hình gốc**: Standard 3.5" × 2", 14pt, Matte Both, Front Only, Square corners, 3 ngày.
- **Option (trừ Size):** mỗi giá trị có phụ phí riêng **theo từng mức số lượng**, kiểu Vistaprint. Phụ phí có thể âm. Giao diện hiện phụ phí cạnh từng option ("+$1.00").
- **Size:** dùng **hệ số nhân** lên toàn bộ giá, kiểu UPrinting (mục 4.3).
- Tiền lưu bằng **số nguyên cent**. Làm tròn tới cent ở bước cuối cùng.

### 4.1 Giá gốc (seed): lấy đúng bảng giá Matte của Vistaprint

| Qty | 50 | 100 | 250 | 500 | 1,000 | 2,500 | 5,000 | 10,000 |
|---|---|---|---|---|---|---|---|---|
| base | $10.00 | $14.99 | $19.99 | $24.99 | $37.99 | $80.99 | $127.99 | $222.99 |

### 4.2 Phụ phí option (seed, giá tạm)

> **Đây là giá tạm** để admin có dữ liệu khởi đầu. Toàn bộ bảng giá sẽ được thiết kế lại sau (decision B4).

Phụ phí tính bằng **% của base_price ở cùng mức số lượng**, làm tròn tới cent, rồi lưu thành số cent cụ thể cho từng mức:

| Option value | % base | Suy ra từ |
|---|---|---|
| Paper `16pt` | +25% | UPrinting: 16pt Gloss $46.74 so với 14pt Gloss $37.29 |
| Paper `17pt_uncoated` | +166% | UPrinting: 17pt Uncoated $99.03 so với $37.29 |
| Coating `gloss_both` | +7% | Vistaprint: Glossy +$1 trên $14.99 |
| Coating `uncoated_both` | +7% | Vistaprint: Uncoated +$1 trên $14.99 |
| Coating `uv_both` | +7% | Tạm coi như Gloss (chưa có dữ liệu) |
| Coating `uv_front_uncoated_back` | +43% | UPrinting: $53.32 so với $37.29 |
| Coating `uv_front_gloss_back` | +43% | Tạm coi như UV Front/Uncoated Back (chưa có dữ liệu) |
| Coating `soft_touch_both` | +24% | UPrinting: 16pt Soft Touch $55.65 so với 16pt Gloss $46.74 |
| Coating `silk_both` | +24% | UPrinting: Silk cùng giá Soft Touch |
| Side `front_back` | +58% | UPrinting: in 2 mặt $37.29 so với 1 mặt $23.63 |
| Side `same_both` | +58% | Như front_back |
| Corners `rounded_quarter` | +47% | Vistaprint: Rounded +$7 trên $14.99 |
| Turnaround `5d` | −10% | Chưa có dữ liệu (đã đồng ý dùng tạm) |
| Turnaround `2d` | +30% | UPrinting: 2 ngày so với 3 ngày |
| Turnaround `1d` | +80% | UPrinting: 1 ngày so với 3 ngày |

Các giá trị mặc định (14pt, matte_both, front_only, square, 3d) có phụ phí 0.

### 4.3 Hệ số size (seed, clone UPrinting)

Số liệu gốc ở [research mục 2, Custom Size](../research/02-business-card-competitors.md). Hệ số đo ở mức 500 card.

| Size | Hệ số | Nguồn |
|---|---|---|
| `std_3_5x2` | 1.00 | |
| `slim_3_5x1_75` | 1.31 | UPrinting Slim $48.76 / $37.29 |
| `square_2_5` | 1.96 | UPrinting Square $72.98 / $37.29 |
| `custom` | công thức bên dưới | UPrinting custom size |

**Công thức Custom Size** (W, H tính bằng inch, không phân biệt chiều ngang/dọc):

```
nếu card lọt trong khung 2" × 3.5":   hệ số = fit_multiplier            (seed: 1.25)
ngược lại:                             hệ số = max(fit_multiplier, W × H × area_multiplier)   (seed: 0.283)
```

Kiểm tra với dữ liệu UPrinting ở 500 card:

| Kích thước | Công thức | UPrinting thực tế |
|---|---|---|
| 2" × 2" | 1.25 | 1.22 |
| 2" × 3" | 1.25 | 1.30 |
| 2" × 4" | 2.26 | 2.08 |
| 2.5" × 3.5" | 2.48 | 2.43 |
| 3" × 3" | 2.55 | 2.55 |
| 3" × 4" | 3.40 | 3.40 |
| 4" × 4" | 4.53 | 4.53 |

`fit_box`, `fit_multiplier` và `area_multiplier` lưu trong `attributes` của value `custom`, admin sửa được. Hệ số thật của UPrinting **thay đổi theo số lượng** (1.6–2.6 lần ở size 3" × 3"). MVP dùng một hệ số cho mọi mức số lượng, sẽ xem lại khi thiết kế lại bảng giá.

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
- MVP **chỉ nhận PDF** cho mặt trước, và mặt sau nếu Printed Side = `front_back`.
- Upload thẳng lên S3 bằng presigned URL. Giới hạn kích thước file lưu trong cấu hình.
- Template tải về (PDF có sẵn bleed và safe zone) cho từng size có sẵn.

### 6.3 Preflight tự động (worker Python)

| Kiểm tra | Kết quả nếu không đạt |
|---|---|
| Kích thước trang khớp file có bleed (có sai số cho phép) | **Lỗi**: bắt upload lại |
| Kích thước bằng trim, thiếu bleed | **Cảnh báo** |
| Số trang khớp với Printed Side | **Lỗi** |
| Ảnh dưới 300 DPI | **Cảnh báo** |
| Font chưa nhúng | **Lỗi** |
| Hệ màu RGB | **Cảnh báo**, hệ thống tự chuyển sang CMYK khi in |
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
    -- size preset: {trim_w_in, trim_h_in, bleed_in, safe_in, price_multiplier}
    -- size custom: {min_in, max_in, step_in, bleed_in, safe_in,
    --               fit_box: {w_in, h_in}, fit_multiplier, area_multiplier}
    -- paper:       {thickness_pt, tier}
    -- coating:     {front, back, laminated}
    -- printed_side:{back: 'separate' | 'blank' | 'same_as_front'}
    -- corners:     {radius_in}
    -- turnaround:  {business_days}
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
  id, product_id, quantity, base_price_cents, sort_order, is_active, is_default
  UNIQUE (product_id, quantity)

option_value_prices
  option_value_id → option_values.id, quantity_tier_id → product_quantity_tiers.id,
  upcharge_cents (có thể âm)
  PRIMARY KEY (option_value_id, quantity_tier_id)

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
- Order item lưu **toàn bộ cấu hình và giá tại thời điểm đặt** (snapshot), gồm cả W × H của custom size. Đổi cấu hình hay bảng giá sau đó không ảnh hưởng đơn cũ.
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
  0003_seed_business_cards_pricing.sql         -- base price + upcharge (mục 4.1, 4.2)
  0004_seed_production_settings.sql            -- 2pm PT, Thứ Hai–Thứ Sáu, ngày lễ 2026–2027
  0005_seed_shipping_methods.sql               -- 3 phương thức ship mẫu (mục 7)
```

Phụ phí trong `0003` được tính sẵn ra cent cho từng mức số lượng, để đọc file SQL là biết chính xác giá trị nạp vào.

---

## 11. Màn hình admin (phạm vi MVP)

| Màn hình | Chức năng |
|---|---|
| Product → Option groups | Danh sách nhóm, đổi thứ tự, đổi label, kiểu hiển thị |
| Option group → Values | Thêm/sửa/ẩn value, chọn mặc định, sửa attributes (form theo loại nhóm) |
| **Paper detail** | Tab "Coatings available" (checkbox), tab "Turnaround available". Lưu vào `option_value_rules`. |
| Coating detail | Tab "Turnaround available" |
| Size detail | Kích thước, bleed, safe zone, hệ số giá. Riêng Custom: min/max/bước, khung, các hệ số. |
| Rules | Xem toàn bộ ràng buộc dạng bảng |
| Pricing | Bảng giá gốc theo số lượng. Ma trận phụ phí: value × số lượng, sửa trực tiếp. |
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
- [x] Phụ phí seed ở mục 4.2 dùng làm giá tạm, kể cả Turnaround 5 ngày −10%
- [x] Số lượng bắt đầu từ 50
- [x] Custom Size: 2"–4", bước 0.25", tính giá theo UPrinting (mục 4.3)
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
