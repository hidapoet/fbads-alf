import OAuthProvider, { type AuthRequest, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers; CONNECT_PASSWORD: string };

const factSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  campaign_id: z.string().min(1),
  campaign_name: z.string().min(1),
  adset_id: z.string().min(1),
  adset_name: z.string().min(1),
  ad_id: z.string().min(1),
  ad_name: z.string().min(1),
  objective: z.string().nullable().optional(),
  optimization_goal: z.string().nullable().optional(),
  result_group: z.enum(["Inbox", "Engage", "Lead", "Click", "View", "Reach", "Sales", "Recall"]),
  result_action_type: z.string().nullable().optional(),
  spend: z.number().nonnegative(),
  impressions: z.number().nonnegative(),
  reach: z.number().nonnegative(),
  frequency: z.number().nonnegative().nullable().optional(),
  clicks_link: z.number().nonnegative(),
  ctr: z.number().nonnegative().nullable().optional(),
  cpc: z.number().nonnegative().nullable().optional(),
  cpm: z.number().nonnegative().nullable().optional(),
  result_value: z.number().nonnegative(),
  cost_per_result: z.number().nonnegative().nullable().optional(),
  effective_status: z.string().nullable().optional(),
});

export class AlfAdsIngestMcp extends McpAgent<Env, unknown, { userId: string }> {
  server = new McpServer({ name: "ALF Ads Dashboard", version: "1.0.0" });

  async init(): Promise<void> {
    this.server.tool(
      "publish_fb_ads_report",
      "Ghi dữ liệu báo cáo vừa lấy từ Meta Ads MCP vào ALF Ads Monitor. Chỉ gọi sau khi đã dùng Meta Ads MCP để lấy dữ liệu thật. Gửi mỗi quảng cáo theo từng ngày; không gửi dữ liệu minh họa.",
      {
        ad_account_id: z.string().min(5).describe("ID tài khoản quảng cáo Meta, có hoặc không có tiền tố act_"),
        granularity: z.enum(["daily", "realtime"]),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        rows: z.array(factSchema).max(5000),
      },
      async ({ ad_account_id, granularity, from, to, rows }) => {
        const now = new Date().toISOString();
        const normalized = rows.map((row) => ({
          ...row,
          granularity,
          objective: row.objective ?? null,
          optimization_goal: row.optimization_goal ?? null,
          result_action_type: row.result_action_type ?? null,
          frequency: row.frequency ?? null,
          ctr: row.ctr ?? null,
          cpc: row.cpc ?? null,
          cpm: row.cpm ?? null,
          cost_per_result: row.cost_per_result ?? null,
          effective_status: row.effective_status ?? null,
          updated_at: now,
        }));
        await this.env.CONFIG.put("agent:fb_ads_fact", JSON.stringify({
          adAccountId: ad_account_id.replace(/^act_/, ""),
          granularity,
          from,
          to,
          rows: normalized,
          receivedAt: now,
          publisher: this.props?.userId ?? "alf-owner",
        }));
        return {
          content: [{
            type: "text",
            text: `Đã chuyển ${normalized.length} bản ghi Meta Ads MCP lên ALF Ads Monitor. Dashboard cập nhật lúc ${now}.`,
          }],
        };
      },
    );

    this.server.tool("get_alf_sync_status", "Kiểm tra lần gần nhất ChatGPT hoặc Claude đã chuyển dữ liệu Meta Ads MCP lên dashboard ALF.", {}, async () => {
      const stored = await this.env.CONFIG.get("agent:fb_ads_fact", "json");
      return { content: [{ type: "text", text: stored ? JSON.stringify(stored) : "Chưa có dữ liệu nào được agent chuyển lên." }] };
    });
  }
}

function html(body: string, status = 200, headers: HeadersInit = {}): Response {
  return new Response(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ALF MCP</title><style>body{font:16px system-ui;background:#f5f7fa;color:#172033;margin:0;display:grid;place-items:center;min-height:100vh}.box{width:min(420px,calc(100% - 40px));background:white;border:1px solid #d9dee8;border-radius:16px;padding:28px;box-shadow:0 16px 50px #17203318}h1{font-size:22px;margin:0 0 8px}p{color:#586174;line-height:1.5}label{display:block;font-weight:600;margin:20px 0 8px}input{box-sizing:border-box;width:100%;padding:11px 12px;border:1px solid #adb5c3;border-radius:8px;font:inherit}button{width:100%;margin-top:16px;padding:12px;border:0;border-radius:8px;background:#0f6cbd;color:white;font:inherit;font-weight:700}</style></head><body><main class="box">${body}</main></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...headers,
    },
  });
}

function cookieValue(request: Request, name: string): string {
  const item = (request.headers.get("Cookie") ?? "").split(";").find((part) => part.trim().startsWith(`${name}=`));
  return item?.trim().slice(name.length + 1) ?? "";
}

async function constantTimeEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const authHandler = {
  async fetch(request: Request, env: OAuthEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return html("<h1>ALF Ads Ingest MCP</h1><p>MCP trung gian để ChatGPT hoặc Claude chuyển số liệu từ Meta Ads MCP sang ALF Ads Monitor.</p>");
    }
    if (url.pathname === "/authorize" && request.method === "GET") {
      const oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const authId = crypto.randomUUID();
      await env.CONFIG.put(`agent:mcp:authorize:${authId}`, JSON.stringify(oauthRequest), { expirationTtl: 600 });
      return html(
        `<h1>Cho phép ALF Ads MCP</h1><p>ChatGPT/Claude yêu cầu quyền ghi báo cáo quảng cáo vào dashboard của bạn.</p><form method="post" action="/approve"><input type="hidden" name="auth_id" value="${authId}"><label for="password">Mật khẩu quản trị</label><input id="password" name="password" type="password" required autofocus><button type="submit">Đăng nhập và cho phép</button></form>`,
        200,
        { "Set-Cookie": `__Host-ALF_MCP_AUTH=${authId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600` },
      );
    }
    if (url.pathname === "/approve" && request.method === "POST") {
      const body = await request.formData();
      const authId = String(body.get("auth_id") ?? "");
      const password = String(body.get("password") ?? "");
      const ipHash = await sha256Hex(request.headers.get("CF-Connecting-IP") ?? "unknown");
      const attemptsKey = `agent:mcp:attempts:${ipHash}`;
      const attempts = Number.parseInt(await env.CONFIG.get(attemptsKey) ?? "0", 10);
      if (attempts >= 5) return html("<h1>Tạm khóa đăng nhập</h1><p>Đã thử quá nhiều lần. Hãy thử lại sau 10 phút.</p>", 429);
      if (!authId || authId !== cookieValue(request, "__Host-ALF_MCP_AUTH") || !await constantTimeEqual(password, env.CONNECT_PASSWORD)) {
        await env.CONFIG.put(attemptsKey, String(attempts + 1), { expirationTtl: 600 });
        return html("<h1>Không thể cấp quyền</h1><p>Mật khẩu hoặc phiên xác thực không hợp lệ.</p>", 401);
      }
      const stored = await env.CONFIG.get(`agent:mcp:authorize:${authId}`, "json");
      await env.CONFIG.delete(`agent:mcp:authorize:${authId}`);
      if (!stored || typeof stored !== "object") return html("<h1>Phiên đã hết hạn</h1><p>Hãy kết nối lại MCP.</p>", 401);
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: stored as AuthRequest,
        userId: "alf-owner",
        metadata: { label: "ALF Ads Monitor" },
        scope: (stored as AuthRequest).scope,
        props: { userId: "alf-owner" },
      });
      await env.CONFIG.delete(attemptsKey);
      return Response.redirect(redirectTo, 302);
    }
    return new Response("Not found", { status: 404 });
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: AlfAdsIngestMcp.serve("/mcp"),
  defaultHandler: authHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  allowPlainPKCE: false,
});
