# Luồng từ thiết kế tới checkout của đối thủ

Research ngày **2026-10-23**, đi thật trên trình duyệt (Claude in Chrome) với business card tiêu chuẩn, như khách vãng lai. Chỉ xem: **không điền thông tin cá nhân, không đặt hàng**. Trang checkout và thanh toán của Vistaprint và 48HourPrint không cho extension đọc, nên phần đó lấy từ UPrinting (cùng kiểu với 48HourPrint).

| Site | Đi tới đâu | Độ tin cậy |
|---|---|---|
| Vistaprint | Template → editor → duyệt thiết kế → Final Steps → upsell → giỏ → màn đăng nhập/guest | Cao (trang checkout bên trong không đọc được) |
| UPrinting | Buy now & upload later → giỏ → checkout (thấy các bước) | Cao |
| 48HourPrint | Upload Your Artwork → trang upload (có tùy chọn proof) | Cao |
| MOO | Trang sản phẩm (chọn cách thiết kế); không vào được editor nếu chưa chọn đủ option | Trung bình |

## Từng bước

| Bước | Vistaprint | UPrinting / 48HourPrint | MOO | Mình (2026-10-23) |
|---|---|---|---|---|
| Chọn cách thiết kế | 3 lựa chọn: Browse templates, Upload your design, **Let us design it for you từ $29** | Upload / Design online / **Buy now & upload later** | Radio: templates / design your own / full upload. Không có dịch vụ thiết kế | 3 thẻ: Upload / Template / Let us design it (decision P14) |
| Danh sách template | Cột bộ lọc + lưới | Có (Design online) | Có | Cột bộ lọc + lưới |
| Mặt sau | Sau khi xong mặt trước mới hỏi: giống mặt trước / upload / trơn / template, có phụ phí | Upload riêng mặt trước, mặt sau | | Chọn "Printed side" ở bước 1 |
| **Duyệt trước khi vào giỏ** | Màn "Review your design": checklist (chữ dễ đọc, đúng chính tả, ảnh nét), **cảnh báo chữ mẫu chưa sửa**, bắt tick "I have reviewed and approve my design" | Không | | Không. Cảnh báo hiện ngay trong form |
| **Proof sau khi đặt** | Không thấy bước này với template (khách tự duyệt) | Khách chọn lúc upload: **Print Right Away** hoặc **Wait – I want a PDF proof** (proof gửi qua email) | | **Luôn có proof**, chưa duyệt thì không in (P9) |
| Upload | PDF và nhiều định dạng | Mặt trước và sau riêng; từ máy, **Dropbox, Google Drive**, file gần đây; nhận cả JPG, PNG, PSD, AI, Word, PowerPoint… | | Chỉ PDF |
| Upload sau | | **Có**: thêm vào giỏ trước, upload trong giỏ hoặc sau khi đặt | | Không |
| Sau Add to cart | Trang **Final Steps** (chọn lại số lượng, độ dày, giấy, có nhãn "Recommended") → trang **phụ kiện** → trang **gợi ý sản phẩm khác** | Vào thẳng giỏ | | Ở lại trang, hiện link "View cart" |
| Giỏ hàng | Edit design, Edit options, số lượng, **promo code**, nút **PayPal / Apple Pay**, PayPal trả 4 lần, thanh **"còn $X nữa được free ship"** | Sửa số lượng và turnaround ngay trong giỏ, đặt tên item, upload / design từ giỏ | | Số lượng, Edit, Remove, ngày giao |
| Vào checkout | **Màn đăng nhập trước**: passcode, Google, Apple, Facebook, mật khẩu, tạo tài khoản, **Continue as guest** | Bước "Customer Info" trong checkout | | Guest mặc định; đăng nhập không bắt buộc |
| Checkout | (không đọc được) | **Một trang, 4 bước dạng accordion**: Customer Info → Shipping Address → Shipping Options → Payment Method, cột tóm tắt (tiền in, phí ship, thuế) | | Một trang: Contact, Shipping address, Shipping method, Payment, cột tóm tắt, Place order |
| Thanh toán | Thẻ, PayPal, Apple Pay, Venmo (logo ở chân trang) | Thẻ | | Thủ công (tạm, T14) |

## Khác biệt đáng chú ý

1. **Template: Vistaprint cho khách tự duyệt trước khi vào giỏ, không gửi proof sau.** Mình bắt duyệt proof sau khi đặt cho cả template, thêm một bước và làm chậm việc in.
2. **Upload: UPrinting / 48HourPrint cho khách chọn có cần proof hay không.** Mình luôn bắt duyệt.
3. **"Buy now & upload later"** (UPrinting, 48HourPrint): khách đặt và trả tiền trước, gửi file sau.
4. **Giỏ hàng của Vistaprint bán thêm mạnh**: promo code, free-ship progress, nút thanh toán nhanh, 3 trang upsell sau Add to cart.
5. **Nhận nhiều định dạng file** và upload từ Dropbox, Google Drive (48HourPrint). Mình chỉ nhận PDF.
