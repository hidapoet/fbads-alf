# ALF Ads Monitor

Dashboard theo dõi Facebook Ads theo campaign, ad set và ad. Hệ thống chuẩn hóa kết quả theo `objective` và `optimization_goal`, đồng bộ qua Cloudflare Workers, lưu tại Supabase và hiển thị bằng React + Fluent UI.

## Kiến trúc

- React + Fluent UI: dashboard responsive, bộ lọc, KPI, biểu đồ và bảng cây.
- Cloudflare Worker: API đọc báo cáo, cron đồng bộ Meta Marketing API và phục vụ static assets.
- Supabase: bảng fact theo ngày/realtime, views tuần/tháng, RLS chỉ đọc và Realtime.
- GitHub Actions: typecheck, build, deploy Worker và migration khi đủ secrets.

Meta Ads MCP được dùng để khám phá và xác nhận field trong phiên agent. Job production gọi Meta Graph API trực tiếp vì Worker không duy trì phiên MCP tương tác.

## Chạy cục bộ

```bash
pnpm install
pnpm run types
pnpm run dev
```

Tạo `.dev.vars` với các biến server-only:

```text
SUPABASE_SECRET_KEY=
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
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
wrangler secret put META_ACCESS_TOKEN
wrangler secret put META_AD_ACCOUNT_ID
wrangler secret put SYNC_SECRET
```

Migration nằm trong `supabase/migrations` và cần Supabase Personal Access Token cùng database password để chạy `supabase db push`.
