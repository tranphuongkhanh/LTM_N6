# PLAN — OTTv2 online demo (30–45 phút)

Giữ HTML/CSS/JavaScript thuần, giao diện/màu/bàn cờ hiện tại, `board[row][col]`, 18 quân mỗi bên (6 mỗi loại), luật di chuyển và ăn quân. Không React, viết lại dự án, server riêng, tài khoản, chat, khôi phục ván hay chuyển chủ phòng.

Đã đọc `README.md`, `index.html`, `style.css`, `script.js`; `git diff` và diff staged hiện rỗng. Chỉ lập kế hoạch, chưa triển khai.

## 8 đầu việc

1. **Chốt state và thắng — 4 phút (`script.js`).** Sửa `checkWin`: Đỏ chỉ thắng ở **i9**, Xanh chỉ ở **a1**; giữ thắng khi ăn hết một loại đối phương. Snapshot/restore deep-copy bàn cờ, lượt, nhật ký và kết quả `{winner, reason}`; số quân tính lại từ bàn cờ. Thêm revision tăng đơn điệu, kể cả hoàn tác/reset; không khôi phục revision cũ.
2. **Nối playhtml — 4 phút (`index.html`, `script.js`).** Import module ghim `playhtml@2.14.1`, dùng public backend mặc định (không cấu hình `host`). Dùng `createPageData` cho snapshot và yêu cầu ở hai kênh riêng. Callback nhận snapshot chỉ restore/render, không ghi ngược dữ liệu; chặn thao tác khi chưa đồng bộ.
3. **Phòng và link mời — 6 phút (ba file giao diện).** Thêm Tạo phòng/Sao chép link và trạng thái kết nối, không đổi thiết kế bàn cờ. Sinh ID bằng `crypto.randomUUID()`, link `?room=<id>`, cấu hình `init({room: 'ottv2-v1-' + id})` rõ ràng. Hai máy dùng cùng origin/path của trang; người tạo giữ vai chủ/Đỏ trong phiên, chủ cấp ghế Xanh cho một khách; từ chối người thứ ba. Link không chứa quyền chủ.
4. **Chủ duyệt lệnh — 9 phút (`script.js`).** Mọi nước đi, kể cả của chủ, qua cùng bộ xử lý. Request gồm `requestId`, người gửi, `baseRevision`, loại lệnh và ô đi/đến. Chủ kiểm tra ghế, đủ hai người, lượt, chưa thắng, tọa độ nguyên trong bàn, quân nguồn/đích và luật hiện tại; tự tính kiểu đi/ăn, không tin `moveType` từ mạng. Gia cố `performMove`; xử lý tuần tự, bỏ request trùng/cũ, trả ack hoặc lý do từ chối. Dùng dữ liệu bền của playhtml, không dùng event thoáng qua làm nguồn nước đi.
5. **Đồng bộ toàn ván — 5 phút (`script.js`).** Chỉ chủ xuất snapshot đầy đủ sau lệnh hợp lệ. Hai máy nhận cùng bàn cờ, lượt, số quân suy ra, nhật ký, kết quả và revision; đồng bộ cả modal thắng. Khách không tự cập nhật bàn cờ trước ack; xóa lựa chọn/gợi ý khi nhận state mới.
6. **Hoàn tác/ván mới — 4 phút (`script.js`, nút hiện có).** Bản demo chỉ chủ được dùng Hoàn tác, Ván mới và Chơi lại; khóa nút phía khách và kiểm tra quyền trong bộ xử lý. History chỉ ở bộ nhớ chủ; mỗi thao tác phát snapshot mới cho cả hai, phục hồi/xóa kết quả thắng đúng cách, giữ ghế và tăng revision để loại lệnh của ván cũ.
7. **Mất kết nối và hướng dẫn — 3 phút (`script.js`, `README.md`).** Dùng presence đúng phòng và báo lỗi kết nối; khóa chơi khi thiếu người hoặc mất backend. Chủ rời/tải lại trang thì phiên kết thúc, không tự bầu chủ hay khôi phục; tạo phòng mới để chơi tiếp. Ghi cách chạy qua HTTP(S), mở hai trình duyệt và giới hạn: public backend lưu dữ liệu, quyền chủ chỉ do client tuân thủ, không chống client sửa mã/gian lận.
8. **Chạy test bên dưới — 10 phút.** Ưu tiên demo trên hai trình duyệt độc lập, không thêm framework/build system. Nếu CDN/backend lỗi, báo chặn thật, không coi hai bàn cờ cục bộ là online thành công.

## Test cần chạy

- **Hồi quy:** hình thức và tọa độ không đổi; mỗi bên 18 quân, từng loại 6; các nước đi/ăn hợp lệ và không hợp lệ vẫn theo luật cũ.
- **Thắng:** Đỏ→i9 thắng, Đỏ→a1 không thắng theo góc; Xanh→a1 thắng, Xanh→i9 không thắng theo góc. Ăn hết từng loại vẫn thắng; sau thắng không nhận nước đi. Snapshot→restore giữ người thắng/lý do/modal.
- **Hai trình duyệt:** tạo phòng, mở link, nhận đúng ghế; luân phiên đi/ăn và so sánh board, lượt, số quân, log, winner, revision; không nhân đôi log hoặc có vòng lặp ghi state.
- **Lệnh mạng:** sai lượt/ghế, ngoài bàn, ô nguồn rỗng/quân đối phương, đi/ăn sai luật, giả `moveType`, gửi lặp, revision cũ, hai lệnh đồng thời → không đổi state trái phép; nước hợp lệ chỉ áp dụng một lần.
- **Điều khiển:** khách không hoàn tác/reset được kể cả gửi lệnh; chủ hoàn tác nước ăn/nước thắng và Ván mới/Chơi lại → hai máy giống nhau; lệnh chậm trước reset bị loại.
- **Cách ly/lỗi:** hai phòng chạy đồng thời không lẫn board/log/lệnh; khách thứ ba bị từ chối; khách vào không reset ván. Rút mạng/đóng/tải lại tab chủ hoặc khách → khóa chơi/báo trạng thái đúng, không phát sinh chủ mới hay tự khôi phục.

Tham chiếu API: [init/room/public host](https://playhtml.fun/docs/reference/init-options/), [page data](https://playhtml.fun/docs/data/page-data/), [presence](https://playhtml.fun/docs/reference/presence/).
