# Template business card

Trạng thái: **Đã làm** (Phase 1 bước 7)
Cập nhật: 2026-10-20
Code: `packages/templates` (định dạng + bộ render), seed: `packages/templates/seed/business-cards-templates.json` → migration `0006_seed_business_card_templates`

## 1. Nguyên tắc

- Template là **dữ liệu JSON trong bảng `templates`**, không hard-code trong code (decision P5, P12).
- **Một bộ render dùng chung** (`renderFace`): JSON + nội dung khách điền → SVG.
  - Trình duyệt: SVG → texture cho card 3D, và ảnh thu nhỏ trong danh sách template.
  - Sau này phía server: cùng SVG đó → PDF in (vùng bleed, không hiện chữ mẫu).
- Mọi layout được kiểm tra bằng schema (zod) khi API đọc từ DB. Template nào sai định dạng sẽ bị bỏ qua và ghi log, không làm hỏng trang.

## 2. Định dạng layout (version 1)

```jsonc
{
  "version": 1,
  "fields": [
    { "key": "name", "label": "Full name", "type": "text", "side": "front", "sample": "Alex Morgan", "maxLength": 40 },
    { "key": "logo", "label": "Logo", "type": "image", "side": "both" }
  ],
  "front": { "background": "#ffffff", "elements": [ /* ... */ ] },
  "back":  { "background": "#1f3a5f", "elements": [ /* ... */ ] }
}
```

**Field:** `key`, `label`, `type` (`text` | `image`), `side` (`front` | `back` | `both`), `sample` (chữ mẫu hiện tới khi khách gõ), `maxLength`, `inputMode` (`text` | `tel` | `email` | `url`). Field chỉ ở mặt sau sẽ ẩn khỏi form khi khách chọn in một mặt.

**Hộp tham chiếu** (`box`). Vị trí tính bằng **tỷ lệ 0..1** của hộp, nên một layout tự co giãn theo mọi size:

| box | Là | Dùng cho |
|---|---|---|
| `bleed` | Trim + bleed mỗi cạnh | Nền, dải màu chạy tràn ra mép |
| `trim` | Thành phẩm sau khi cắt | |
| `safe` (mặc định cho chữ, ảnh) | Trim trừ safe zone | Chữ, logo: không bao giờ bị cắt mất |

**Element:**

| type | Thuộc tính |
|---|---|
| `text` | `field`, `x`, `y` (đường chân chữ), `maxWidth`, `align` (`start` / `middle` / `end`), `font` (`sans` / `serif`), `weight`, `size` (pt), `minSize`, `color`, `uppercase`, `letterSpacing` (em) |
| `image` | `field`, `x`, `y`, `width`, `height`, `align`, `placeholderColor` (khung "LOGO" khi chưa có ảnh) |
| `rect` | `x`, `y`, `width`, `height`, `fill`, `radius` (pt) |

- Màu luôn ở dạng `#rrggbb`.
- Chữ dài hơn `maxWidth` thì **tự thu nhỏ**, tối đa xuống `minSize`. Vẫn không vừa thì form báo "Too long to fit at a readable size".
- Đơn vị SVG là point (1 inch = 72pt).

## 3. Template đã seed

| code | Tên | Size hỗ trợ | Đặc điểm |
|---|---|---|---|
| `classic` | Classic | Tất cả + custom | Căn trái, logo góc trên, mặt sau xanh navy |
| `centered` | Centered | Tất cả + custom | Căn giữa, chữ serif, mặt sau màu vàng đồng |
| `color-band` | Color Band | Standard, Slim, custom | Dải màu teal bên trái có logo |
| `minimal` | Minimal | Standard, Slim, custom | Nhiều khoảng trắng, đường kẻ mảnh, liên hệ 2 cột |
| `midnight` | Midnight | Tất cả + custom | Mặt trước nền tối tràn viền, điểm nhấn màu cam |

Các template dùng chung bộ field (`name`, `title`, `company`, `phone`, `email`, `website`, `address`, `tagline`, `logo`). Nhờ vậy khi khách đổi template, nội dung đã gõ vẫn được giữ.

## 4. Hành vi trên homepage

- Danh sách template **lọc theo size** đang chọn. Đổi size mà template hiện tại không hỗ trợ thì tự chuyển sang template đầu tiên hỗ trợ, có thông báo, giữ nguyên nội dung.
- Ảnh thu nhỏ của template hiển thị **bằng chính nội dung khách đang gõ**.
- Logo: PNG, JPG, WebP, SVG, tối đa 5 MB. Ảnh lớn hơn 1200px tự thu nhỏ. Phase 1 logo chỉ nằm trên trình duyệt (chưa upload lên server).
- Đo chữ: trên trình duyệt dùng canvas (`canvasMeasure`). Khi render phía server, hoặc trước khi trang chạy xong, dùng bảng ước lượng có sẵn.
