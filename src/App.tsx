import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Skeleton,
  SkeletonItem,
  Spinner,
  Tab,
  TabList,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildTree, buildTrend, summarize, summarizeGroups, type TreeNode } from "./metrics";
import type { DashboardResponse, FactRow, Period, ResultGroup } from "./types";

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "realtime", label: "Realtime" },
  { value: "daily", label: "Ngày" },
  { value: "weekly", label: "Tuần" },
  { value: "monthly", label: "Tháng" },
];

const GROUP_LABEL: Record<ResultGroup, string> = {
  Inbox: "Tin nhắn",
  Engage: "Tương tác",
  Lead: "Lead",
  Click: "Click",
  View: "Lượt xem",
  Reach: "Tiếp cận",
  Sales: "Chuyển đổi",
  Recall: "Ghi nhớ",
};

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function useSystemTheme() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setDark(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return [dark, setDark] as const;
}

export function App() {
  const [dark, setDark] = useSystemTheme();
  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme} className="app-provider">
      <Dashboard dark={dark} onThemeChange={() => setDark((value) => !value)} />
    </FluentProvider>
  );
}

function Dashboard({ dark, onThemeChange }: { dark: boolean; onThemeChange: () => void }) {
  const [period, setPeriod] = useState<Period>("daily");
  const [range, setRange] = useState(defaultRange);
  const [response, setResponse] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [group, setGroup] = useState("ALL");
  const [sortBy, setSortBy] = useState<"spend" | "cost">("spend");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [connectOpen, setConnectOpen] = useState(() => new URLSearchParams(window.location.search).get("connect") === "mcp");
  const [connectStep, setConnectStep] = useState<"password" | "credentials">("password");
  const [connectPassword, setConnectPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [metaToken, setMetaToken] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period, from: range.from, to: range.to });
      const result = await fetch(`/api/dashboard?${params}`);
      if (!result.ok) throw new Error(`Không thể tải dữ liệu (${result.status})`);
      const payload = (await result.json()) as DashboardResponse;
      setResponse(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tải báo cáo");
    } finally {
      setLoading(false);
    }
  }, [period, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const openWithShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if (event.key.toLocaleLowerCase() === "i" && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditing) {
        event.preventDefault();
        setConnectOpen(true);
      }
    };
    window.addEventListener("keydown", openWithShortcut);
    return () => window.removeEventListener("keydown", openWithShortcut);
  }, []);

  useEffect(() => {
    if (period !== "realtime" || response?.source !== "supabase") return;
    let cleanup = () => undefined;
    void (async () => {
      const configResponse = await fetch("/api/config");
      if (!configResponse.ok) return;
      const config = (await configResponse.json()) as { url: string; publishableKey: string };
      const client = createClient(config.url, config.publishableKey);
      const channel = client
        .channel("fb-ads-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "fb_ads_fact", filter: "granularity=eq.realtime" }, () => {
          void load(true);
        })
        .subscribe();
      cleanup = () => {
        void client.removeChannel(channel);
      };
    })();
    return () => cleanup();
  }, [load, period, response?.source]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    return (response?.rows ?? []).filter((row) => {
      const textMatch = !needle || `${row.campaign_name} ${row.adset_name} ${row.ad_name}`.toLocaleLowerCase("vi").includes(needle);
      const statusMatch = status === "ALL" || row.effective_status === status;
      const groupMatch = group === "ALL" || row.result_group === group;
      return textMatch && statusMatch && groupMatch;
    });
  }, [group, query, response?.rows, status]);

  const totals = useMemo(() => summarize(filteredRows), [filteredRows]);
  const groups = useMemo(() => summarizeGroups(filteredRows), [filteredRows]);
  const trend = useMemo(() => buildTrend(filteredRows), [filteredRows]);
  const tree = useMemo(() => buildTree(filteredRows, sortBy), [filteredRows, sortBy]);

  function toggleNode(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function resetConnectionDialog() {
    setConnectStep("password");
    setConnectPassword("");
    setSetupToken("");
    setMetaToken("");
    setAdAccountId("");
    setConnectError(null);
  }

  async function unlockConnection() {
    setConnectBusy(true);
    setConnectError(null);
    try {
      const result = await fetch("/api/mcp/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: connectPassword }),
      });
      const payload = await result.json() as { setupToken?: string; error?: string };
      if (!result.ok || !payload.setupToken) throw new Error(payload.error ?? "Mật khẩu không đúng.");
      setSetupToken(payload.setupToken);
      setConnectPassword("");
      setConnectStep("credentials");
    } catch (cause) {
      setConnectError(cause instanceof Error ? cause.message : "Không thể mở khóa kết nối.");
    } finally {
      setConnectBusy(false);
    }
  }

  async function connectMcp() {
    setConnectBusy(true);
    setConnectError(null);
    try {
      const result = await fetch("/api/mcp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupToken, accessToken: metaToken.trim(), adAccountId: adAccountId.trim() }),
      });
      const payload = await result.json() as { error?: string };
      if (!result.ok) throw new Error(payload.error ?? "Không thể kết nối Facebook Ads MCP.");
      setConnectOpen(false);
      resetConnectionDialog();
      await load();
    } catch (cause) {
      setConnectError(cause instanceof Error ? cause.message : "Không thể kết nối Facebook Ads MCP.");
    } finally {
      setConnectBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">A</div>
          <div>
            <p className="product-name">ALF Ads Monitor</p>
            <p className="product-context">Facebook Ads Performance</p>
          </div>
        </div>
        <div className="header-actions">
          <Badge appearance="tint" color={response?.source === "supabase" ? "success" : "warning"}>
            {response?.source === "supabase" ? "Dữ liệu thật" : "Dữ liệu minh họa"}
          </Badge>
          <Button appearance="subtle" className="connect-shortcut" onClick={() => setConnectOpen(true)} aria-label="Kết nối Facebook Ads MCP">
            <kbd>i</kbd><span>Kết nối MCP</span>
          </Button>
          <Button appearance="subtle" onClick={onThemeChange} aria-label="Đổi giao diện sáng tối">{dark ? "Sáng" : "Tối"}</Button>
          <Button appearance="primary" onClick={() => void load()} disabled={loading}>
            Làm mới
          </Button>
        </div>
      </header>

      <section className="page-heading">
        <div>
          <h1>Hiệu suất quảng cáo</h1>
          <p>Phát hiện campaign tiêu bất thường và theo dõi đúng kết quả theo từng mục tiêu tối ưu.</p>
        </div>
        <div className="sync-meta">
          <span>Cập nhật {response ? new Date(response.syncedAt).toLocaleString("vi-VN") : "đang kiểm tra"}</span>
        </div>
      </section>

      {response?.source === "demo" && (
        <MessageBar intent="warning" className="source-message">
          <MessageBarBody>
            <MessageBarTitle>Đang hiển thị dữ liệu minh họa</MessageBarTitle>
            {response.message}
          </MessageBarBody>
        </MessageBar>
      )}
      {error && (
        <MessageBar intent="error" className="source-message">
          <MessageBarBody><MessageBarTitle>Lỗi kết nối</MessageBarTitle>{error}</MessageBarBody>
        </MessageBar>
      )}

      <section className="control-surface" aria-label="Bộ lọc báo cáo">
        <TabList selectedValue={period} onTabSelect={(_, data) => setPeriod(data.value as Period)} appearance="subtle">
          {PERIODS.map((item) => <Tab key={item.value} value={item.value}>{item.label}</Tab>)}
        </TabList>
        <div className="filters">
          <Input value={query} onChange={(_, data) => setQuery(data.value)} placeholder="Tìm campaign, nhóm hoặc quảng cáo" aria-label="Tìm kiếm" />
          <Input type="date" value={range.from} onChange={(_, data) => setRange((current) => ({ ...current, from: data.value }))} aria-label="Từ ngày" />
          <Input type="date" value={range.to} onChange={(_, data) => setRange((current) => ({ ...current, to: data.value }))} aria-label="Đến ngày" />
          <Dropdown value={status === "ALL" ? "Mọi trạng thái" : status === "ACTIVE" ? "Đang chạy" : "Tạm dừng"} selectedOptions={[status]} onOptionSelect={(_, data) => setStatus(data.optionValue ?? "ALL")} aria-label="Trạng thái">
            <Option value="ALL">Mọi trạng thái</Option><Option value="ACTIVE">Đang chạy</Option><Option value="PAUSED">Tạm dừng</Option>
          </Dropdown>
          <Dropdown value={group === "ALL" ? "Mọi mục tiêu" : GROUP_LABEL[group as ResultGroup]} selectedOptions={[group]} onOptionSelect={(_, data) => setGroup(data.optionValue ?? "ALL")} aria-label="Nhóm kết quả">
            <Option value="ALL">Mọi mục tiêu</Option>
            {Object.entries(GROUP_LABEL).map(([value, label]) => <Option key={value} value={value}>{label}</Option>)}
          </Dropdown>
        </div>
      </section>

      {loading ? <LoadingDashboard /> : (
        <>
          <section className="kpi-grid" aria-label="Chỉ số tổng quan">
            <Metric label="Chi tiêu" value={money.format(totals.spend)} hint={`${number.format(filteredRows.length)} bản ghi`} accent />
            <Metric label="CTR" value={`${number.format(totals.ctr)}%`} hint={`${number.format(totals.clicks)} click liên kết`} />
            <Metric label="CPC (link click)" value={money.format(totals.cpc)} hint="Chi phí mỗi click liên kết" />
            <Metric label="Impressions" value={number.format(totals.impressions)} hint="Lượt hiển thị" />
            <Metric label="Reach" value={number.format(totals.reach)} hint="Người tiếp cận" />
            <Metric label="Tần suất" value={number.format(totals.frequency)} hint="Số lần hiển thị trung bình" />
          </section>

          <section className="analysis-grid">
            <div className="trend-panel panel">
              <div className="panel-heading">
                <div><h2>Xu hướng chi tiêu</h2><p>Chi tiêu và tổng kết quả theo ngày</p></div>
              </div>
              {trend.length > 0 ? (
                <div className="chart-wrap" role="img" aria-label="Biểu đồ xu hướng chi tiêu và kết quả">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--line-subtle)" />
                      <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="spend" tickFormatter={(value: number) => `${Math.round(value / 1000)}k`} tickLine={false} axisLine={false} width={48} />
                      <YAxis yAxisId="result" orientation="right" tickLine={false} axisLine={false} width={38} />
                      <ChartTooltip formatter={(value, name) => {
                        const numericValue = typeof value === "number" ? value : Number(value ?? 0);
                        return name === "spend" ? money.format(numericValue) : number.format(numericValue);
                      }} />
                      <Bar yAxisId="spend" dataKey="spend" fill="var(--chart-bar)" radius={[5, 5, 0, 0]} maxBarSize={44} />
                      <Line yAxisId="result" type="monotone" dataKey="results" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState text="Không có dữ liệu xu hướng trong khoảng đã chọn." />}
            </div>

            <div className="group-panel panel">
              <div className="panel-heading"><div><h2>Kết quả theo mục tiêu</h2><p>Chỉ hiện nhóm có dữ liệu</p></div></div>
              <div className="group-list">
                {groups.map((item) => (
                  <div className="group-row" key={item.group}>
                    <span className={`group-token group-${item.group.toLowerCase()}`}>{GROUP_LABEL[item.group]}</span>
                    <div className="group-value"><strong>{number.format(item.value)}</strong><span>{item.cost ? money.format(item.cost) : "Chưa có chi phí"}</span></div>
                  </div>
                ))}
                {groups.length === 0 && <EmptyState text="Không có nhóm kết quả phù hợp." />}
              </div>
            </div>
          </section>

          <section className="table-panel panel">
            <div className="panel-heading table-heading">
              <div><h2>Campaign và quảng cáo</h2><p>Mở từng cấp để đối chiếu action type thực tế</p></div>
              <Dropdown value={sortBy === "spend" ? "Chi tiêu cao nhất" : "Chi phí kết quả cao nhất"} selectedOptions={[sortBy]} onOptionSelect={(_, data) => setSortBy((data.optionValue as "spend" | "cost") ?? "spend")} aria-label="Sắp xếp">
                <Option value="spend">Chi tiêu cao nhất</Option><Option value="cost">Chi phí kết quả cao nhất</Option>
              </Dropdown>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Tên</th><th>Nhóm kết quả</th><th>Chi tiêu</th><th>Kết quả</th><th>Chi phí / kết quả</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {tree.flatMap((node) => renderTreeRows(node, expanded, toggleNode))}
                </tbody>
              </table>
              {tree.length === 0 && <EmptyState text="Không có campaign phù hợp với bộ lọc." />}
            </div>
          </section>
        </>
      )}
      <Dialog open={connectOpen} onOpenChange={(_, data) => {
        setConnectOpen(data.open);
        if (!data.open) resetConnectionDialog();
      }}>
        <DialogSurface className="connect-dialog">
          <DialogBody>
            <DialogTitle>{connectStep === "password" ? "Mở khóa kết nối MCP" : "Kết nối Facebook Ads MCP"}</DialogTitle>
            <DialogContent className="connect-dialog-content">
              {connectStep === "password" ? (
                <>
                  <p>Nhập mật khẩu quản trị để tiếp tục. Mật khẩu được kiểm tra an toàn ở Cloudflare Worker.</p>
                  <Field label="Mật khẩu" required>
                    <Input type="password" autoFocus value={connectPassword} onChange={(_, data) => setConnectPassword(data.value)} onKeyDown={(event) => {
                      if (event.key === "Enter" && connectPassword) void unlockConnection();
                    }} />
                  </Field>
                </>
              ) : (
                <>
                  <p>Nhập token Meta có quyền đọc quảng cáo và ID tài khoản quảng cáo cần theo dõi.</p>
                  <Field label="Meta access token" required>
                    <Input type="password" autoFocus value={metaToken} onChange={(_, data) => setMetaToken(data.value)} placeholder="EAA…" />
                  </Field>
                  <Field label="Ad account ID" hint="Chỉ nhập dãy số, không cần tiền tố act_" required>
                    <Input value={adAccountId} onChange={(_, data) => setAdAccountId(data.value)} placeholder="1234567890" />
                  </Field>
                </>
              )}
              {connectError && <MessageBar intent="error"><MessageBarBody>{connectError}</MessageBarBody></MessageBar>}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setConnectOpen(false)} disabled={connectBusy}>Hủy</Button>
              {connectStep === "password" ? (
                <Button appearance="primary" onClick={() => void unlockConnection()} disabled={connectBusy || !connectPassword}>
                  {connectBusy ? <Spinner size="tiny" /> : "Tiếp tục"}
                </Button>
              ) : (
                <Button appearance="primary" onClick={() => void connectMcp()} disabled={connectBusy || !metaToken.trim() || !adAccountId.trim()}>
                  {connectBusy ? <Spinner size="tiny" /> : "Kết nối"}
                </Button>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <footer>ALF Ads Monitor. Nguồn dữ liệu: Meta Marketing API, Cloudflare Workers và Supabase.</footer>
    </main>
  );
}

function Metric({ label, value, hint, accent = false }: { label: string; value: string; hint: string; accent?: boolean }) {
  return <article className={`metric ${accent ? "metric-accent" : ""}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function renderTreeRows(node: TreeNode, expanded: Set<string>, toggle: (id: string) => void): React.ReactNode[] {
  const isOpen = expanded.has(node.id);
  const canExpand = node.children.length > 0;
  const rows: React.ReactNode[] = [
    <tr key={node.id} className={`tree-${node.level}`}>
      <td>
        <div className="tree-name" style={{ paddingLeft: `${node.level === "campaign" ? 0 : node.level === "adset" ? 24 : 52}px` }}>
          {canExpand ? <Button appearance="subtle" size="small" onClick={() => toggle(node.id)} aria-label={isOpen ? "Thu gọn" : "Mở rộng"}>{isOpen ? "−" : "+"}</Button> : <span className="tree-spacer" />}
          <span><strong>{node.name}</strong>{node.level === "ad" && node.actionType && <small>{node.actionType}</small>}</span>
        </div>
      </td>
      <td><span className={`group-token group-${node.group.toLowerCase()}`}>{GROUP_LABEL[node.group]}</span></td>
      <td className="num">{money.format(node.spend)}</td>
      <td className="num">{number.format(node.result)}</td>
      <td className="num">{node.cost ? money.format(node.cost) : "-"}</td>
      <td><Badge appearance="tint" color={node.status === "ACTIVE" ? "success" : "subtle"}>{node.status === "ACTIVE" ? "Đang chạy" : node.status === "PAUSED" ? "Tạm dừng" : "Chưa rõ"}</Badge></td>
    </tr>,
  ];
  if (isOpen) node.children.forEach((child) => rows.push(...renderTreeRows(child, expanded, toggle)));
  return rows;
}

function LoadingDashboard() {
  return <div className="loading-layout" aria-label="Đang tải dữ liệu"><Skeleton><div className="skeleton-grid">{Array.from({ length: 6 }, (_, index) => <SkeletonItem key={index} className="skeleton-card" />)}</div><SkeletonItem className="skeleton-panel" /></Skeleton></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span>{text}</span></div>;
}
