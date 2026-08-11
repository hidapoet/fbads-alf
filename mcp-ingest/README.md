# ALF Ads Ingest MCP

Remote MCP để ChatGPT hoặc Claude chuyển dữ liệu vừa đọc từ Meta Ads MCP sang ALF Ads Monitor.

- MCP URL: `https://fbads-alf-ingest-mcp.fbads-alf.workers.dev/mcp`
- OAuth: đăng nhập bằng mật khẩu quản trị của dashboard.
- Tool ghi: `publish_fb_ads_report`
- Tool kiểm tra: `get_alf_sync_status`

## Cấu hình ChatGPT

1. Bật Developer mode trong **Settings → Apps → Advanced settings**.
2. Tạo custom app với MCP URL ở trên và chọn OAuth.
3. Kết nối cả Meta Ads MCP và ALF Ads Ingest MCP trong cùng Workspace Agent.
4. Đặt lịch cho agent với chỉ dẫn:

```text
Mỗi ngày, dùng Meta Ads MCP lấy dữ liệu thật ở cấp ad cho tài khoản cần theo dõi,
time_increment=1 trong 7 ngày gần nhất. Sau đó chuẩn hóa từng dòng theo schema của
publish_fb_ads_report và gọi tool đó để chuyển toàn bộ báo cáo lên ALF Ads Monitor.
Không tạo dữ liệu mẫu. Sau cùng gọi get_alf_sync_status và báo số dòng đã chuyển.
```

ChatGPT full MCP write actions và Workspace Agent schedules phụ thuộc gói/quyền quản trị của workspace. Với Claude, thêm URL MCP này và Meta Ads MCP vào cùng client rồi dùng cùng chỉ dẫn; khả năng chạy lịch phụ thuộc sản phẩm Claude đang dùng.
