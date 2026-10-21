# Tổng quan thị trường in online ở Mỹ

Research ngày 2026-10-19.

## 1. Traffic các site in ấn ở Mỹ

Nguồn: Semrush Traffic Analytics, danh mục "Printing", **tháng 9/2026**. Đây là số **ước tính**, chỉ dùng để so sánh tương đối. Đã bỏ các site không phải in thương mại (printables.com, crealitycloud.com là site mô hình 3D).

| # | Site | Visits/tháng | So với tháng trước | So với năm trước | Mobile | Mảng chính |
|---|---|---|---|---|---|---|
| 1 | officedepot.com | 6.35M | ↓22.9% | ↓10.7% | 59% | In kèm đồ văn phòng, in tại cửa hàng |
| 2 | **vistaprint.com** | 6.03M | ↑19.3% | ↑18.1% | 60% | Đủ loại cho SMB |
| 3 | theupsstore.com | 4.96M | ↑6.0% | ↓0.7% | 67% | In tại cửa hàng |
| 4 | zazzle.com | 4.16M | ↑6.6% | ↑1.5% | 73% | Quà tặng cá nhân hoá, marketplace |
| 5 | printify.com | 3.29M | ↓3.2% | ↓1.6% | 46% | Print-on-demand (B2B) |
| 6 | avery.com | 2.56M | ↓14.6% | ↓5.3% | 41% | Nhãn, label |
| 7 | snapfish.com | 1.43M | ↑8.4% | ↑8.3% | 71% | In ảnh |
| 8 | stickermule.com | 1.37M | ↑2.8% | ↑20.5% | 54% | Sticker, label, bao bì |
| 9 | lulu.com | 1.14M | ↓0.6% | ↑27.6% | 67% | In sách |
| 10 | **gotprint.com** | 983K | ↑5.2% | ↑28.1% | 59% | Giá rẻ, số lượng lớn |
| 11 | deluxe.com | 973K | ↓11.3% | ↓11.2% | 56% | Séc, giấy tờ doanh nghiệp |
| 12 | **moo.com** | 839K | ↑24.0% | ↑8.1% | 55% | Business card cao cấp |
| 13 | fastsigns.com | 799K | ↑60.6% | ↑72.3% | 81% | Biển hiệu, khổ lớn |
| 14 | **uprinting.com** | 712K | ↓6.0% | ↑11.7% | 34% | Nhiều sản phẩm, giao nhanh |
| — | 48hourprint.com | ngoài top 20 | | | | Giao nhanh 24–48h |

Gần như tất cả đều có nguồn traffic chính là **Direct**, tức thương hiệu mạnh và khách quay lại.

## 2. Quy mô thị trường

- **Cimpress** (công ty mẹ Vistaprint), năm tài chính 2026: doanh thu **$3.74B**, tăng 10% (tăng 4% nếu tính organic theo tỷ giá cố định). Mảng promo products, apparel & gifts của Vistaprint đạt hơn **$355M**, tăng 11%. Dự kiến năm tài chính 2027 tăng ít nhất 7%.
- **Web-to-print toàn cầu:** các báo cáo chênh nhau rất nhiều, từ $8.7B (MarkWide) đến $34.9B (The Business Research Company) cho năm 2026, tuỳ cách tính.
- **Quick printing ở Mỹ** (mảng cửa hàng truyền thống): $4.4B năm 2026, giảm 4% (IBISWorld). Khách đang chuyển dần sang đặt online.

## 3. Phân nhóm đối thủ

| | Nhóm A: Thương hiệu cho khách lẻ | Nhóm B: Kiểu nhà in |
|---|---|---|
| Site | Vistaprint, MOO, Zazzle, Office Depot | GotPrint, UPrinting, 48HourPrint |
| Khách hàng | Chủ shop nhỏ, không biết in | Designer, agency, khách đã có file |
| Tên giấy | Tên thương mại (Premium Plus, Super, Luxe) | Thông số kỹ thuật (14 pt. Cardstock Gloss) |
| Coating | Gắn với giấy, khách không chọn riêng | Tách riêng, chọn được từng mặt |
| Điểm mạnh | Template, công cụ thiết kế, đơn giản | Giá rẻ, nhiều tổ hợp, giao nhanh |
| Traffic | Cao nhất | Thấp hơn |

Định vị của dự án: **cấu trúc dữ liệu theo nhóm B, trình bày theo nhóm A** (xem [decisions.md](../decisions.md), P1/P2).

## 4. Những yếu tố riêng của thị trường Mỹ

- **Sales tax:** mỗi bang khác nhau. Sau phán quyết Wayfair, phải thu thuế ở bang mình vượt ngưỡng doanh thu (economic nexus). Dùng Stripe Tax.
- **Đơn vị:** inch, độ dày giấy tính bằng pt, định lượng tính bằng lb. Không dùng mm/gsm trên giao diện.
- **Ngày lễ liên bang** ảnh hưởng cách tính business days (turnaround).
- **Accessibility:** chuẩn ADA/WCAG, kiện tụng ở mảng này rất phổ biến.
- **Privacy:** CCPA (California).
- **Ship:** UPS / USPS / FedEx, khách quen có mã theo dõi đơn.

## Nguồn

- [Semrush – Top Printing Websites in the United States](https://www.semrush.com/trending-websites/us/printing)
- [ASI Central – Cimpress revenue rises 10% in FY2026](https://members.asicentral.com/news/industry-news/july-2026/cimpress-revenue-rises-10-in-fiscal-year-2026/)
- [Nasdaq – Cimpress Q4 earnings call highlights](https://www.nasdaq.com/articles/cimpress-q4-earnings-call-highlights)
- [The Business Research Company – Web to Print Global Market Report](https://www.thebusinessresearchcompany.com/report/web-to-print-global-market-report)
- [MarkWide Research – Web to Print Market](https://markwideresearch.com/web-to-print-market)
- [IBISWorld – US Quick Printing market size](https://img3.ibisworld.com/united-states/market-size/quick-printing/437/)
- [DesignNBuy – 8 Best Online Printing Services in the US for 2026](https://www.designnbuy.com/blog/best-online-printing-services-in-us/)
