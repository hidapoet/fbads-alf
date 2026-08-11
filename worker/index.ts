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

type MetaConfig = {
  accessToken: string;
  adAccountId: string;
  refreshToken?: string;
  expiresAt?: number;
};

type StoredMetaConfig = MetaConfig & {
  connectedAt: string;
};

type AdAccount = {
  id: string;
  name: string;
  currency?: string;
  status?: string;
  timezone?: string;
};

type OAuthSelection = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  accounts: AdAccount[];
};

const MCP_ENDPOINT = "https://mcp.facebook.com/ads";
const MCP_AUTH_METADATA_ENDPOINT = "https://mcp.facebook.com/.well-known/oauth-authorization-server/ads";
const MCP_SCOPES = [
  "ads_management", "ads_read", "catalog_management", "business_management",
  "pages_show_list", "instagram_basic", "ads_mcp_management",
];

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
  if (isRecord(stored) && typeof stored.sealed === "string") {
    const decrypted = await openOAuthState(env, stored.sealed);
    if (isRecord(decrypted) && typeof decrypted.accessToken === "string" && typeof decrypted.adAccountId === "string") {
      return {
        accessToken: decrypted.accessToken,
        adAccountId: decrypted.adAccountId,
        refreshToken: typeof decrypted.refreshToken === "string" ? decrypted.refreshToken : undefined,
        expiresAt: typeof decrypted.expiresAt === "number" ? decrypted.expiresAt : undefined,
      };
    }
  }
  if (isRecord(stored) && typeof stored.accessToken === "string" && typeof stored.adAccountId === "string") {
    return {
      accessToken: stored.accessToken,
      adAccountId: stored.adAccountId,
      refreshToken: typeof stored.refreshToken === "string" ? stored.refreshToken : undefined,
      expiresAt: typeof stored.expiresAt === "number" ? stored.expiresAt : undefined,
    };
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

async function readBoundedText(response: Response, maxBytes = 2_000_000): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error("Meta MCP response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseMcpPayload(text: string, contentType: string): unknown {
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { return JSON.parse(data) as unknown; } catch { /* Continue to the next event. */ }
    }
    throw new Error("Meta MCP returned an invalid event stream");
  }
  return JSON.parse(text) as unknown;
}

async function mcpRequest(accessToken: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, ...(params ? { params } : {}) }),
  });
  const text = await readBoundedText(response);
  if (!response.ok) throw new Error(`Meta MCP returned ${response.status}`);
  const payload = parseMcpPayload(text, response.headers.get("Content-Type") ?? "application/json");
  if (!isRecord(payload)) throw new Error("Meta MCP returned an invalid JSON-RPC response");
  if (isRecord(payload.error)) throw new Error(typeof payload.error.message === "string" ? payload.error.message : "Meta MCP tool call failed");
  return payload.result;
}

async function mcpToolCall(accessToken: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await mcpRequest(accessToken, "tools/call", { name, arguments: args });
  if (isRecord(result) && result.isError === true) {
    throw new Error("Meta MCP reported a tool error");
  }
  return result;
}

function parseEmbeddedJson(text: string): unknown | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned) as unknown; } catch { return null; }
}

function extractAccounts(value: unknown): AdAccount[] {
  const accounts = new Map<string, AdAccount>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!isRecord(candidate)) return;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      const embedded = parseEmbeddedJson(candidate.text);
      if (embedded !== null) visit(embedded);
    }
    const rawId = candidate.account_id ?? candidate.ad_account_id ?? candidate.id;
    const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).replace(/^act_/, "") : "";
    const looksLikeAccount = /^[0-9]{5,30}$/.test(id) && (
      "account_id" in candidate || "ad_account_id" in candidate || "currency" in candidate || "account_status" in candidate
    );
    if (looksLikeAccount) {
      accounts.set(id, {
        id,
        name: typeof candidate.name === "string" ? candidate.name : `Tài khoản ${id}`,
        currency: typeof candidate.currency === "string" ? candidate.currency : undefined,
        status: typeof candidate.account_status === "string" || typeof candidate.account_status === "number" ? String(candidate.account_status) : undefined,
        timezone: typeof candidate.timezone_name === "string" ? candidate.timezone_name : undefined,
      });
    }
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return [...accounts.values()];
}

function toMetaActions(value: unknown): MetaAction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((item) => ({
    action_type: typeof item.action_type === "string" ? item.action_type : undefined,
    value: typeof item.value === "string" || typeof item.value === "number" ? String(item.value) : undefined,
  }));
}

function recordToInsight(record: Record<string, unknown>): MetaInsight | null {
  const nested = isRecord(record.insights) ? record.insights : isRecord(record.metrics) ? record.metrics : {};
  const value = { ...record, ...nested };
  const entityType = typeof value.entity_type === "string" ? value.entity_type.toUpperCase() : "";
  const adIdValue = value.ad_id ?? (entityType === "AD" ? value.id : undefined);
  if (typeof adIdValue !== "string" && typeof adIdValue !== "number") return null;
  const stringValue = (key: string): string | undefined => {
    const item = value[key];
    return typeof item === "string" || typeof item === "number" ? String(item) : undefined;
  };
  return {
    date_start: stringValue("date_start") ?? stringValue("date"),
    campaign_id: stringValue("campaign_id"),
    campaign_name: stringValue("campaign_name"),
    adset_id: stringValue("adset_id"),
    adset_name: stringValue("adset_name"),
    ad_id: String(adIdValue),
    ad_name: stringValue("ad_name") ?? stringValue("name"),
    objective: stringValue("objective"),
    optimization_goal: stringValue("optimization_goal"),
    spend: stringValue("spend"),
    impressions: stringValue("impressions"),
    reach: stringValue("reach"),
    frequency: stringValue("frequency"),
    ctr: stringValue("ctr"),
    cpc: stringValue("cpc"),
    cpm: stringValue("cpm"),
    actions: toMetaActions(value.actions),
    cost_per_action_type: toMetaActions(value.cost_per_action_type),
    estimated_ad_recallers: stringValue("estimated_ad_recallers"),
    effective_status: stringValue("effective_status") ?? stringValue("status"),
  };
}

function extractInsights(value: unknown): MetaInsight[] {
  const insights: MetaInsight[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!isRecord(candidate)) return;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      const embedded = parseEmbeddedJson(candidate.text);
      if (embedded !== null) visit(embedded);
    }
    const insight = recordToInsight(candidate);
    if (insight) insights.push(insight);
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return insights;
}

function schemaProperty(schema: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return isRecord(schema.properties) && isRecord(schema.properties[key]) ? schema.properties[key] : null;
}

function buildAdEntityArgs(schema: Record<string, unknown>, adAccountId: string, date: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const assignFirst = (keys: string[], value: unknown): boolean => {
    const key = keys.find((candidate) => schemaProperty(schema, candidate));
    if (!key) return false;
    args[key] = value;
    return true;
  };
  assignFirst(["ad_account_id", "account_id"], `act_${adAccountId}`);
  assignFirst(["entity_type", "entity_level", "level"], "ad");
  assignFirst(["time_range", "date_range"], { since: date, until: date });
  assignFirst(["since", "start_date"], date);
  assignFirst(["until", "end_date"], date);
  assignFirst(["include_insights", "include_metrics", "with_insights"], true);
  assignFirst(["limit"], 500);
  const fields = [
    "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", "objective",
    "optimization_goal", "spend", "impressions", "reach", "frequency", "ctr", "cpc", "cpm",
    "actions", "cost_per_action_type", "estimated_ad_recallers", "effective_status", "date_start",
  ];
  const fieldsKey = ["fields", "metrics"].find((key) => schemaProperty(schema, key));
  if (fieldsKey) args[fieldsKey] = schemaProperty(schema, fieldsKey)?.type === "string" ? fields.join(",") : fields;
  return args;
}

async function getAdEntitySchema(env: Env, accessToken: string): Promise<Record<string, unknown>> {
  const cached = await env.CONFIG.get("meta:mcp:ad-entity-schema", "json");
  if (isRecord(cached)) return cached;
  const result = await mcpRequest(accessToken, "tools/list");
  if (!isRecord(result) || !Array.isArray(result.tools)) throw new Error("Meta MCP did not return its tool list");
  const tool = result.tools.find((item) => isRecord(item) && item.name === "ads_get_ad_entities");
  if (!isRecord(tool) || !isRecord(tool.inputSchema)) throw new Error("ads_get_ad_entities is unavailable for this account");
  await env.CONFIG.put("meta:mcp:ad-entity-schema", JSON.stringify(tool.inputSchema), { expirationTtl: 86_400 });
  return tool.inputSchema;
}

async function readMcpRows(env: Env, meta: MetaConfig, granularity: "realtime" | "daily"): Promise<FactRow[]> {
  const date = dateInVietnam();
  const schema = await getAdEntitySchema(env, meta.accessToken);
  const result = await mcpToolCall(meta.accessToken, "ads_get_ad_entities", buildAdEntityArgs(schema, meta.adAccountId, date));
  const unique = new Map<string, FactRow>();
  for (const insight of extractInsights(result)) {
    insight.date_start ??= date;
    const row = insightToFact(insight, granularity);
    if (row) unique.set(`${row.date}:${row.ad_id}`, row);
  }
  return [...unique.values()];
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
  const rows = await readMcpRows(env, meta, granularity);
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

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function oauthStateKey(env: Env): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.OAUTH_STATE_SECRET));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sealOAuthState(env: Env, value: Record<string, unknown>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await oauthStateKey(env), plaintext);
  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.byteLength);
  return toBase64Url(combined);
}

async function openOAuthState(env: Env, value: string): Promise<Record<string, unknown> | null> {
  try {
    const combined = fromBase64Url(value);
    if (combined.byteLength < 29 || combined.byteLength > 4_096) return null;
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await oauthStateKey(env), ciphertext);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decrypted));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function oauthErrorRedirect(request: Request, message: string): Response {
  const target = new URL("/", request.url);
  target.searchParams.set("connect", "mcp");
  target.searchParams.set("oauth_error", message.slice(0, 180));
  return Response.redirect(target.toString(), 302);
}

async function startMcpOAuth(request: Request, env: Env): Promise<Response> {
  if (!env.META_APP_ID || !env.OAUTH_STATE_SECRET) return json({ error: "MCP OAuth chưa được cấu hình." }, { status: 503 });
  const url = new URL(request.url);
  const setupToken = url.searchParams.get("setup_token") ?? "";
  const setupKey = `mcp:setup:${setupToken}`;
  const unlocked = setupToken.length <= 64 ? await env.CONFIG.get(setupKey) : null;
  if (!unlocked) return oauthErrorRedirect(request, "Phiên mở khóa đã hết hạn. Hãy thử lại.");
  await env.CONFIG.delete(setupKey);

  const codeVerifier = toBase64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challengeDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const redirectUri = `${url.origin}/api/oauth/meta/callback`;
  const metadataResponse = await fetch(MCP_AUTH_METADATA_ENDPOINT, { headers: { Accept: "application/json" } });
  const metadataText = await readBoundedText(metadataResponse, 32_000);
  let metadata: unknown = null;
  try { metadata = JSON.parse(metadataText) as unknown; } catch { /* Handled below. */ }
  if (!metadataResponse.ok || !isRecord(metadata) || typeof metadata.authorization_endpoint !== "string" || typeof metadata.token_endpoint !== "string") {
    return oauthErrorRedirect(request, "Không thể đọc cấu hình OAuth từ Ads MCP.");
  }
  const state = await sealOAuthState(env, {
    codeVerifier,
    redirectUri,
    tokenEndpoint: metadata.token_endpoint,
    nonce: crypto.randomUUID(),
    expiresAt: Date.now() + 10 * 60_000,
  });
  const authorizationUrl = new URL(metadata.authorization_endpoint);
  authorizationUrl.search = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: MCP_SCOPES.join(" "),
    state,
    code_challenge: toBase64Url(new Uint8Array(challengeDigest)),
    code_challenge_method: "S256",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: { Location: authorizationUrl.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

async function finishMcpOAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (oauthError) return oauthErrorRedirect(request, oauthError);
  const code = url.searchParams.get("code") ?? "";
  const state = await openOAuthState(env, url.searchParams.get("state") ?? "");
  const codeVerifier = typeof state?.codeVerifier === "string" ? state.codeVerifier : "";
  const redirectUri = typeof state?.redirectUri === "string" ? state.redirectUri : "";
  const tokenEndpoint = typeof state?.tokenEndpoint === "string" ? state.tokenEndpoint : "";
  const expiresAt = typeof state?.expiresAt === "number" ? state.expiresAt : 0;
  const tokenUrl = tokenEndpoint ? new URL(tokenEndpoint) : null;
  if (!code || !codeVerifier || redirectUri !== `${url.origin}/api/oauth/meta/callback` || expiresAt < Date.now() || tokenUrl?.protocol !== "https:" || !tokenUrl.hostname.endsWith("facebook.com")) {
    return oauthErrorRedirect(request, "Phiên OAuth không hợp lệ hoặc đã hết hạn.");
  }

  const tokenResponse = await fetch(tokenUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.META_APP_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const tokenText = await readBoundedText(tokenResponse, 64_000);
  let tokenPayload: unknown = null;
  try { tokenPayload = JSON.parse(tokenText) as unknown; } catch { /* Handled below. */ }
  if (!tokenResponse.ok || !isRecord(tokenPayload) || typeof tokenPayload.access_token !== "string") {
    console.error(JSON.stringify({ message: "MCP OAuth token exchange failed", status: tokenResponse.status }));
    return oauthErrorRedirect(request, "Facebook không thể cấp quyền MCP. Hãy kiểm tra cấu hình ứng dụng.");
  }

  const accessToken = tokenPayload.access_token;
  const accountResult = await mcpToolCall(accessToken, "ads_get_ad_accounts", {});
  const accounts = extractAccounts(accountResult);
  if (accounts.length === 0) return oauthErrorRedirect(request, "Ads MCP chưa trả về tài khoản quảng cáo nào cho người dùng này.");
  const resultId = crypto.randomUUID();
  const selection: OAuthSelection = {
    accessToken,
    refreshToken: typeof tokenPayload.refresh_token === "string" ? tokenPayload.refresh_token : undefined,
    expiresAt: typeof tokenPayload.expires_in === "number" ? Date.now() + tokenPayload.expires_in * 1_000 : undefined,
    accounts,
  };
  const sealedSelection = await sealOAuthState(env, {
    accessToken: selection.accessToken,
    refreshToken: selection.refreshToken,
    expiresAt: selection.expiresAt,
  });
  await env.CONFIG.put(`mcp:oauth-result:${resultId}`, JSON.stringify({ sealed: sealedSelection, accounts }), { expirationTtl: 600 });
  const target = new URL("/", request.url);
  target.searchParams.set("connect", "mcp");
  target.searchParams.set("oauth_result", resultId);
  return Response.redirect(target.toString(), 302);
}

async function getMcpOAuthResult(request: Request, env: Env): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const selection = id.length <= 64 ? await env.CONFIG.get(`mcp:oauth-result:${id}`, "json") : null;
  if (!isRecord(selection) || !Array.isArray(selection.accounts)) {
    return json({ error: "Kết quả OAuth đã hết hạn. Hãy đăng nhập lại." }, { status: 404 });
  }
  return json({ accounts: extractAccounts(selection.accounts) });
}

async function completeMcpOAuth(request: Request, env: Env): Promise<Response> {
  const body = await readSmallJson(request);
  const resultId = typeof body?.resultId === "string" ? body.resultId : "";
  const rawAccountId = typeof body?.adAccountId === "string" ? body.adAccountId.trim() : "";
  const adAccountId = rawAccountId.replace(/^act_/, "");
  if (!/^[0-9]{5,30}$/.test(adAccountId) || resultId.length > 64) return json({ error: "Tài khoản quảng cáo không hợp lệ." }, { status: 400 });
  const selection = await env.CONFIG.get(`mcp:oauth-result:${resultId}`, "json");
  if (!isRecord(selection) || typeof selection.sealed !== "string" || !Array.isArray(selection.accounts)) {
    return json({ error: "Phiên chọn tài khoản đã hết hạn. Hãy đăng nhập lại." }, { status: 401 });
  }
  if (!extractAccounts(selection.accounts).some((account) => account.id === adAccountId)) {
    return json({ error: "Tài khoản không thuộc phiên MCP này." }, { status: 403 });
  }
  const decrypted = await openOAuthState(env, selection.sealed);
  if (!isRecord(decrypted) || typeof decrypted.accessToken !== "string") {
    return json({ error: "Phiên MCP không hợp lệ. Hãy đăng nhập lại." }, { status: 401 });
  }
  const stored: StoredMetaConfig = {
    accessToken: decrypted.accessToken,
    adAccountId,
    refreshToken: typeof decrypted.refreshToken === "string" ? decrypted.refreshToken : undefined,
    expiresAt: typeof decrypted.expiresAt === "number" ? decrypted.expiresAt : undefined,
    connectedAt: new Date().toISOString(),
  };
  const sealedConfig = await sealOAuthState(env, stored);
  await Promise.all([
    env.CONFIG.put("meta:mcp", JSON.stringify({ sealed: sealedConfig, adAccountId, connectedAt: stored.connectedAt })),
    env.CONFIG.delete(`mcp:oauth-result:${resultId}`),
  ]);
  return json({ connected: true, adAccountId: `act_${adAccountId}`, connectedAt: stored.connectedAt });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/health") return json({ ok: true, connection: await envReady(env), time: new Date().toISOString() });
  if (url.pathname === "/api/config") return json({ url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY });
  if (url.pathname === "/api/mcp/status" && request.method === "GET") return json({ connected: Boolean(await getMetaConfig(env)) });
  if (url.pathname === "/api/mcp/unlock" && request.method === "POST") return unlockMcp(request, env);
  if (url.pathname === "/api/oauth/meta/start" && request.method === "GET") return startMcpOAuth(request, env);
  if (url.pathname === "/api/oauth/meta/callback" && request.method === "GET") return finishMcpOAuth(request, env);
  if (url.pathname === "/api/oauth/meta/result" && request.method === "GET") return getMcpOAuthResult(request, env);
  if (url.pathname === "/api/oauth/meta/complete" && request.method === "POST") return completeMcpOAuth(request, env);
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
