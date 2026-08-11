# ALF Ads Monitor

Dashboard theo dõi Facebook Ads theo campaign, ad set và ad. Hệ thống chuẩn hóa kết quả theo `objective` và `optimization_goal`, đồng bộ qua Cloudflare Workers, lưu tại Supabase và hiển thị bằng React + Fluent UI.

## Kiến trúc

- React + Fluent UI: dashboard responsive, bộ lọc, KPI, biểu đồ và bảng cây.
- Cloudflare Worker: OAuth, JSON-RPC client cho Meta Ads MCP, API báo cáo, cron đồng bộ và static assets.
- Supabase: bảng fact theo ngày/realtime, views tuần/tháng, RLS chỉ đọc và Realtime.
- GitHub Actions: typecheck, build, deploy Worker và migration khi đủ secrets.

Worker gọi trực tiếp máy chủ `https://mcp.facebook.com/ads` qua JSON-RPC và tool `ads_get_ad_entities`; không gọi Meta Graph Marketing API. Supabase là bộ nhớ đệm tùy chọn: khi bảng chưa sẵn sàng, dashboard đọc trực tiếp từ MCP. Meta đang triển khai Ads MCP theo từng tài khoản nên OAuth có thể thành công trong khi một ad account cụ thể vẫn trả trạng thái chưa được bật MCP.

Nhấn phím `i` để kết nối. Luồng **Dùng mã truy cập** nhận user access token có quyền Ads MCP, xác thực trực tiếp bằng `tools/list` và `ads_get_ad_accounts`, sau đó cho chọn ad account. Token không được lưu trong trình duyệt hoặc Git; Worker mã hóa AES-GCM trước khi ghi vào Cloudflare KV. Luồng OAuth vẫn được giữ làm lựa chọn phụ.

Ngoài luồng trực tiếp, repo có [ALF Ads Ingest MCP](mcp-ingest/README.md). ChatGPT/Claude có thể dùng Meta Ads MCP để đọc dữ liệu rồi gọi `publish_fb_ads_report`; dashboard sẽ ưu tiên dữ liệu agent vừa chuyển từ KV dùng chung.

## Chạy cục bộ

```bash
pnpm install
pnpm run types
pnpm run dev
```

Tạo `.dev.vars` với các biến server-only:

```text
SUPABASE_SECRET_KEY=
CONNECT_PASSWORD=
OAUTH_STATE_SECRET=
SYNC_SECRET=
```

Không đưa các giá trị này vào source hoặc Git.

## Deploy

```bash
pnpm run typecheck
pnpm run build
pnpm run deploy
```

Sau lần deploy đầu, đặt secrets bằng `wrangler secret put`:

```bash
wrangler secret put SUPABASE_SECRET_KEY
wrangler secret put CONNECT_PASSWORD
wrangler secret put OAUTH_STATE_SECRET
wrangler secret put SYNC_SECRET
```

Migration nằm trong `supabase/migrations` và cần Supabase Personal Access Token cùng database password để chạy `supabase db push`.
