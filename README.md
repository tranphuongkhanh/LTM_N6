# OTTv2 — Oẳn Tù Tì v2 (Bàn cờ 9×9 Online)

Trò chơi Oẳn tù tì phiên bản chiến thuật trên bàn cờ 9×9 dành cho 2 người chơi, hỗ trợ cả **chơi cùng máy (hotseat)** và **chơi online 2 trình duyệt** qua thư viện [PlayHTML](https://playhtml.fun).

---

## 1. Luật chơi

- **Bàn cờ & Quân cờ:** Lưới 9×9, cột `a–i` (từ trái sang phải), hàng `1–9` (từ dưới lên trên). Mỗi bên có 18 quân (6 Búa, 6 Kéo, 6 Bao):
  - **Đỏ (Player 1):** Xuất phát ở hàng 1 và 2 (hàng chỉ số 8 và 7).
  - **Xanh (Player 2):** Xuất phát ở hàng 9 và 8 (hàng chỉ số 0 và 1).
- **Di chuyển:** Mỗi quân đi đúng 1 ô theo 8 hướng (tương tự quân Vua trong cờ vua).
- **Ăn quân (Búa – Kéo – Bao):**
  - **Búa** thắng **Kéo**
  - **Kéo** thắng **Bao**
  - **Bao** thắng **Búa**
  - Hai quân **cùng loại** không ăn được nhau mà chỉ đứng chặn đường.
  - Quân khắc mình không thể đi vào vì sẽ thua.
- **Điều kiện thắng:** Thắng ngay lập tức khi:
  1. Ăn sạch hoàn toàn 1 loại quân bất kỳ của đối phương (hết Búa, hết Kéo, hoặc hết Bao), **HOẶC**
  2. **Đỏ** đưa được một quân vào ô **i9** (`row=0, col=8`), **Xanh** đưa được một quân vào ô **a1** (`row=8, col=0`).
  *(Lưu ý: Nước đi vào ô đích vẫn phải là nước đi hợp lệ theo luật di chuyển và ăn quân).*

---

## 2. Hướng dẫn cài đặt & Chạy ứng dụng

### Yêu cầu
- Node.js >= 20.19.0 (hoặc >= 22.12.0)
- npm >= 10.0.0

### Cài đặt dependencies
```bash
npm install
```

### Chạy chế độ phát triển (Development)
```bash
npm run dev
```
Ứng dụng sẽ chạy tại: `http://localhost:5173` (cổng cố định với `strictPort`).

### Chạy kiểm thử tự động (Unit tests)
```bash
npm test
```
Chạy toàn bộ 17 bài test bao phủ logic bàn cờ, ma trận 9 cặp RPS, điều kiện thắng bất đối xứng, chống lệnh trùng (idempotency), và quản lý revision.

### Đóng gói ứng dụng (Build production)
```bash
npm run build
```
Xuất các tệp tĩnh tối ưu vào thư mục `dist/`.

---

## 3. Cách chơi Online 2 người qua 2 trình duyệt

1. Mở `http://localhost:5173` trên trình duyệt thứ nhất.
2. Bấm nút **"Tạo phòng"**:
   - URL sẽ được chuyển thành `http://localhost:5173/?room=<mã_phòng>`.
   - Trình duyệt này giữ vai trò **Đỏ (Chủ phòng / Host)**.
3. Bấm **"Sao chép link mời"** và mở link này trên một trình duyệt khác (hoặc cửa sổ ẩn danh).
4. Trình duyệt thứ hai mở link sẽ tự động được gán vai trò **Xanh (Khách / Guest)**.
5. Khi đủ 2 người, ván đấu bắt đầu:
   - Hai bên lần lượt chọn quân và đi theo lượt.
   - Toàn bộ nước đi được Client chủ phòng kiểm tra hợp lệ tuần tự và đồng bộ qua kênh dữ liệu dùng chung.
   - Bảng số lượng quân, nhật ký nước đi, và thông báo chiến thắng được đồng bộ thời gian thực cho cả hai bên.

---

## 4. Giới hạn của bản Demo

- **Backend công khai:** Bản demo sử dụng backend PartyKit công khai của PlayHTML, dữ liệu phòng tồn tại theo phiên kết nối của máy chủ công cộng.
- **Điều phối phía Client (Client-authoritative):** Client chủ phòng (Host) chịu trách nhiệm kiểm tra luật và cập nhật trạng thái ván đấu. Chưa có backend máy chủ riêng (như Node.js/Go) để ký mật mã chống trường hợp người dùng cố tình can thiệp mã nguồn phía client.
- **Chưa có tài khoản & Lưu trữ lâu dài:** Chưa tích hợp hệ thống tài khoản, lịch sử đấu lưu trữ cơ sở dữ liệu hoặc chat trực tiếp.
- **Mất kết nối:** Khi đối thủ hoặc chủ phòng ngắt kết nối (đóng tab/mất mạng), bàn cờ sẽ khóa và hiển thị thông báo cần tạo phòng mới (không tự động khôi phục ván đấu giữa chừng).
- **Hoàn tác & Ván mới:** Ở chế độ Online, nút "Hoàn tác" bị khóa để đảm bảo tính công bằng; bấm "Ván mới" hoặc "Chơi ván mới" sẽ tạo một phòng chơi mới.
