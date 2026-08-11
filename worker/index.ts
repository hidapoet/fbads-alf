import { SAMPLE_ROWS } from "../src/sample-data";
import type { DashboardResponse, FactRow, ResultGroup } from "../src/types";

type MetaAction = { action_type?: string; value?: string };

type MetaInsight = {
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  objective?: string;
  optimization_goal?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: MetaAction[];
  cost_per_action_type?: MetaAction[];
  estimated_ad_recallers?: string;
  effective_status?: string;
};

type MetaPage = {
  data?: MetaInsight[];
  paging?: { next?: string };
  error?: { message?: string };
};

type MetaConfig = {
  accessToken: string;
  adAccountId: string;
};

type StoredMetaConfig = MetaConfig & {
  connectedAt: string;
};

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, { ...init, headers: { ...jsonHeaders, ...init.headers } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeFact(value: unknown): FactRow | null {
  if (!isRecord(value)) return null;
  const required = ["date", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", "result_group"];
  if (!required.every((key) => typeof value[key] === "string")) return null;
  return {
    date: String(value.date),
    granularity: value.granularity === "realtime" ? "realtime" : "daily",
    campaign_id: String(value.campaign_id),
    campaign_name: String(value.campaign_name),
    adset_id: String(value.adset_id),
    adset_name: String(value.adset_name),
    ad_id: String(value.ad_id),
    ad_name: String(value.ad_name),
    objective: typeof value.objective === "string" ? value.objective : null,
    optimization_goal: typeof value.optimization_goal === "string" ? value.optimization_goal : null,
    result_group: String(value.result_group) as ResultGroup,
    result_action_type: typeof value.result_action_type === "string" ? value.result_action_type : null,
    spend: toNumber(value.spend),
    impressions: toNumber(value.impressions),
    reach: toNumber(value.reach),
    frequency: value.frequency === null ? null : toNumber(value.frequency),
    clicks_link: toNumber(value.clicks_link),
    ctr: value.ctr === null ? null : toNumber(value.ctr),
    cpc: value.cpc === null ? null : toNumber(value.cpc),
    cpm: value.cpm === null ? null : toNumber(value.cpm),
    result_value: toNumber(value.result_value),
    cost_per_result: value.cost_per_result === null ? null : toNumber(value.cost_per_result),
    effective_status: typeof value.effective_status === "string" ? value.effective_status : null,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : new Date().toISOString(),
  };
}

function dateInVietnam(offsetDays = 0): string {
  const value = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

async function getMetaConfig(env: Env): Promise<MetaConfig | null> {
  const stored = await env.CONFIG.get("meta:mcp", "json");
  if (isRecord(stored) && typeof stored.accessToken === "string" && typeof stored.adAccountId === "string") {
    return { accessToken: stored.accessToken, adAccountId: stored.adAccountId };
  }
  if (env.META_ACCESS_TOKEN && env.META_AD_ACCOUNT_ID) {
    return { accessToken: env.META_ACCESS_TOKEN, adAccountId: env.META_AD_ACCOUNT_ID };
  }
  return null;
}

async function envReady(env: Env): Promise<{ supabase: boolean; meta: boolean }> {
  return {
    supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY),
    meta: Boolean(await getMetaConfig(env)),
  };
}

async function fetchDashboard(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "daily";
  const from = url.searchParams.get("from") ?? dateInVietnam(-6);
  const to = url.searchParams.get("to") ?? dateInVietnam();
  const granularity = period === "realtime" ? "realtime" : "daily";
  const connection = await envReady(env);

  if (connection.supabase) {
    const params = new URLSearchParams({
      select: "*",
      granularity: `eq.${granularity}`,
      date: `gte.${from}`,
      order: "date.asc,spend.desc",
      limit: "5000",
    });
    const endpoint = `${env.SUPABASE_URL}/rest/v1/fb_ads_fact?${params.toString()}&date=lte.${encodeURIComponent(to)}`;
    const response = await fetch(endpoint, {
      headers: { apikey: env.SUPABASE_SECRET_KEY, "User-Agent": "alf-ads-worker/1.0" },
    });
    if (response.ok) {
      const raw: unknown = await response.json();
      const rows = Array.isArray(raw) ? raw.map(normalizeFact).filter((row): row is FactRow => row !== null) : [];
      if (rows.length > 0) {
        const payload: DashboardResponse = {
          rows,
          source: "supabase",
          message: "Dữ liệu đã được đọc từ Supabase.",
          syncedAt: rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, rows[0].updated_at),
          connection,
        };
        return json(payload);
      }
    } else {
      console.error(JSON.stringify({ message: "supabase dashboard query failed", status: response.status }));
    }
  }

  const payload: DashboardResponse = {
    rows: SAMPLE_ROWS.filter((row) => granularity === "realtime" ? row.granularity === "realtime" : true),
    source: "demo",
    message: connection.supabase
      ? "Supabase chưa có dữ liệu hoặc bảng fb_ads_fact chưa được tạo."
      : "Chưa cấu hình kết nối Supabase phía Worker.",
    syncedAt: new Date().toISOString(),
    connection,
  };
  return json(payload);
}

function actionValue(actions: MetaAction[] | undefined, type: string): number {
  return toNumber(actions?.find((action) => action.action_type === type)?.value);
}

function mapResult(insight: MetaInsight): { group: ResultGroup; actionType: string | null; value: number; cost: number | null } {
  const goal = insight.optimization_goal ?? "";
  let group: ResultGroup = "Click";
  let actionType: string | null = "link_click";

  if (goal === "CONVERSATIONS") {
    group = "Inbox";
    actionType = "onsite_conversion.messaging_conversation_started_7d";
  } else if (goal === "POST_ENGAGEMENT") {
    group = "Engage";
    actionType = "post_engagement";
  } else if (goal === "LEAD_GENERATION" || goal === "QUALITY_LEAD") {
    group = "Lead";
    actionType = actionValue(insight.actions, "lead") > 0 ? "lead" : "onsite_conversion.lead_grouped";
  } else if (goal === "LANDING_PAGE_VIEWS") {
    group = "Click";
    actionType = "landing_page_view";
  } else if (goal === "THRUPLAY" || goal === "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS") {
    group = "View";
    actionType = goal === "THRUPLAY" ? "video_thruplay_watched" : "video_play_actions";
  } else if (goal === "REACH") {
    group = "Reach";
    actionType = null;
  } else if (goal === "OFFSITE_CONVERSIONS") {
    group = "Sales";
    actionType = "offsite_conversion.fb_pixel_purchase";
  } else if (goal === "AD_RECALL_LIFT") {
    group = "Recall";
    actionType = null;
  }

  const value = group === "Reach"
    ? toNumber(insight.reach)
    : group === "Recall"
      ? toNumber(insight.estimated_ad_recallers)
      : actionValue(insight.actions, actionType ?? "");
  const explicitCost = actionType ? actionValue(insight.cost_per_action_type, actionType) : 0;
  const spend = toNumber(insight.spend);
  const cost = explicitCost > 0 ? explicitCost : value > 0 ? spend / value : null;
  return { group, actionType, value, cost };
}

function insightToFact(insight: MetaInsight, granularity: "realtime" | "daily"): FactRow | null {
  if (!insight.date_start || !insight.campaign_id || !insight.adset_id || !insight.ad_id) return null;
  const result = mapResult(insight);
  return {
    date: insight.date_start,
    granularity,
    campaign_id: insight.campaign_id,
    campaign_name: insight.campaign_name ?? insight.campaign_id,
    adset_id: insight.adset_id,
    adset_name: insight.adset_name ?? insight.adset_id,
    ad_id: insight.ad_id,
    ad_name: insight.ad_name ?? insight.ad_id,
    objective: insight.objective ?? null,
    optimization_goal: insight.optimization_goal ?? null,
    result_group: result.group,
    result_action_type: result.actionType,
    spend: toNumber(insight.spend),
    impressions: toNumber(insight.impressions),
    reach: toNumber(insight.reach),
    frequency: insight.frequency ? toNumber(insight.frequency) : null,
    clicks_link: actionValue(insight.actions, "link_click"),
    ctr: insight.ctr ? toNumber(insight.ctr) : null,
    cpc: insight.cpc ? toNumber(insight.cpc) : null,
    cpm: insight.cpm ? toNumber(insight.cpm) : null,
    result_value: result.value,
    cost_per_result: result.cost,
    effective_status: insight.effective_status ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function readMetaRows(env: Env, meta: MetaConfig, granularity: "realtime" | "daily"): Promise<FactRow[]> {
  const date = dateInVietnam();
  const fields = [
    "date_start", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
    "objective", "optimization_goal", "spend", "impressions", "reach", "frequency", "ctr", "cpc", "cpm",
    "actions", "cost_per_action_type", "estimated_ad_recallers", "effective_status",
  ].join(",");
  const params = new URLSearchParams({
    access_token: meta.accessToken,
    level: "ad",
    fields,
    time_range: JSON.stringify({ since: date, until: date }),
    time_increment: "1",
    limit: "500",
  });
  let next: string | undefined = `https://graph.facebook.com/${env.META_API_VERSION}/act_${meta.adAccountId}/insights?${params}`;
  const rows: FactRow[] = [];
  let pages = 0;
  while (next && pages < 50) {
    const response = await fetch(next);
    const payload = (await response.json()) as MetaPage;
    if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `Meta API returned ${response.status}`);
    (payload.data ?? []).forEach((insight) => {
      const row = insightToFact(insight, granularity);
      if (row) rows.push(row);
    });
    next = payload.paging?.next;
    pages += 1;
  }
  return rows;
}

async function upsertSupabase(env: Env, rows: FactRow[]): Promise<void> {
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const endpoint = `${env.SUPABASE_URL}/rest/v1/fb_ads_fact?on_conflict=date,granularity,ad_id`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
        "User-Agent": "alf-ads-worker/1.0",
      },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) throw new Error(`Supabase upsert failed with ${response.status}`);
  }
}

async function syncAds(env: Env, granularity: "realtime" | "daily"): Promise<{ count: number }> {
  const meta = await getMetaConfig(env);
  if (!meta || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("Missing Meta or Supabase Worker configuration");
  const rows = await readMetaRows(env, meta, granularity);
  if (rows.length > 0) await upsertSupabase(env, rows);
  console.log(JSON.stringify({ message: "ads sync complete", granularity, count: rows.length }));
  return { count: rows.length };
}

async function constantTimeEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function readSmallJson(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 8_192) return null;
  const value: unknown = await request.json();
  return isRecord(value) ? value : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function unlockMcp(request: Request, env: Env): Promise<Response> {
  if (!env.CONNECT_PASSWORD) return json({ error: "Kết nối MCP chưa được cấu hình." }, { status: 503 });
  const ipHash = await sha256Hex(request.headers.get("CF-Connecting-IP") ?? "unknown");
  const attemptsKey = `mcp:attempts:${ipHash}`;
  const attempts = toNumber(await env.CONFIG.get(attemptsKey));
  if (attempts >= 5) return json({ error: "Đã thử quá nhiều lần. Vui lòng thử lại sau 10 phút." }, { status: 429 });

  const body = await readSmallJson(request);
  const password = typeof body?.password === "string" ? body.password : "";
  const authorized = await constantTimeEqual(password, env.CONNECT_PASSWORD);
  if (!authorized) {
    await env.CONFIG.put(attemptsKey, String(attempts + 1), { expirationTtl: 600 });
    return json({ error: "Mật khẩu không đúng." }, { status: 401 });
  }

  const setupToken = crypto.randomUUID();
  await Promise.all([
    env.CONFIG.put(`mcp:setup:${setupToken}`, "1", { expirationTtl: 300 }),
    env.CONFIG.delete(attemptsKey),
  ]);
  return json({ setupToken, expiresIn: 300 });
}

async function connectMcp(request: Request, env: Env): Promise<Response> {
  const body = await readSmallJson(request);
  const setupToken = typeof body?.setupToken === "string" ? body.setupToken : "";
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  const rawAccountId = typeof body?.adAccountId === "string" ? body.adAccountId.trim() : "";
  const adAccountId = rawAccountId.replace(/^act_/, "");
  if (!/^[0-9]{5,30}$/.test(adAccountId) || accessToken.length < 20 || accessToken.length > 4_096) {
    return json({ error: "Token hoặc Ad account ID không hợp lệ." }, { status: 400 });
  }

  const setupKey = `mcp:setup:${setupToken}`;
  const unlocked = setupToken.length <= 64 ? await env.CONFIG.get(setupKey) : null;
  if (!unlocked) return json({ error: "Phiên thiết lập đã hết hạn. Hãy mở khóa lại." }, { status: 401 });
  await env.CONFIG.delete(setupKey);

  const mcpResponse = await fetch("https://mcp.facebook.com/ads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: crypto.randomUUID() }),
  });
  if (!mcpResponse.ok) {
    console.error(JSON.stringify({ message: "Meta MCP credential validation failed", status: mcpResponse.status }));
    return json({ error: "Facebook Ads MCP từ chối token. Hãy kiểm tra quyền và thử lại." }, { status: 400 });
  }

  const stored: StoredMetaConfig = { accessToken, adAccountId, connectedAt: new Date().toISOString() };
  await env.CONFIG.put("meta:mcp", JSON.stringify(stored));
  return json({ connected: true, adAccountId: `act_${adAccountId}`, connectedAt: stored.connectedAt });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/health") return json({ ok: true, connection: await envReady(env), time: new Date().toISOString() });
  if (url.pathname === "/api/config") return json({ url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY });
  if (url.pathname === "/api/mcp/status" && request.method === "GET") return json({ connected: Boolean(await getMetaConfig(env)) });
  if (url.pathname === "/api/mcp/unlock" && request.method === "POST") return unlockMcp(request, env);
  if (url.pathname === "/api/mcp/connect" && request.method === "POST") return connectMcp(request, env);
  if (url.pathname === "/api/dashboard" && request.method === "GET") return fetchDashboard(request, env);
  if (url.pathname === "/api/sync" && request.method === "POST") {
    const authorized = await constantTimeEqual(request.headers.get("Authorization") ?? "", `Bearer ${env.SYNC_SECRET}`);
    if (!authorized) return json({ error: "Unauthorized" }, { status: 401 });
    const granularity = url.searchParams.get("granularity") === "daily" ? "daily" : "realtime";
    return json(await syncAds(env, granularity));
  }
  return json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleApi(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(JSON.stringify({ message: "request failed", error: message, path: new URL(request.url).pathname }));
      return json({ error: "Internal server error" }, { status: 500 });
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const granularity = controller.cron === "0 16 * * *" ? "daily" : "realtime";
    ctx.waitUntil(syncAds(env, granularity).catch((error: unknown) => {
      console.error(JSON.stringify({ message: "scheduled sync failed", granularity, error: error instanceof Error ? error.message : String(error) }));
    }));
  },
} satisfies ExportedHandler<Env>;
