import type { FactRow, ResultGroup } from "./types";

export interface Totals {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
}

export interface GroupSummary {
  group: ResultGroup;
  value: number;
  spend: number;
  cost: number | null;
}

export interface TrendPoint {
  date: string;
  spend: number;
  results: number;
}

export interface TreeNode {
  id: string;
  name: string;
  level: "campaign" | "adset" | "ad";
  group: ResultGroup;
  spend: number;
  result: number;
  cost: number | null;
  status: string;
  actionType: string | null;
  children: TreeNode[];
}

export function summarize(rows: FactRow[]): Totals {
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const reach = rows.reduce((sum, row) => sum + row.reach, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks_link, 0);
  return {
    spend,
    impressions,
    reach,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    frequency: reach > 0 ? impressions / reach : 0,
  };
}

export function summarizeGroups(rows: FactRow[]): GroupSummary[] {
  const groups = new Map<ResultGroup, { value: number; spend: number }>();
  rows.forEach((row) => {
    const current = groups.get(row.result_group) ?? { value: 0, spend: 0 };
    current.value += row.result_value;
    current.spend += row.spend;
    groups.set(row.result_group, current);
  });
  return [...groups.entries()]
    .map(([group, value]) => ({
      group,
      value: value.value,
      spend: value.spend,
      cost: value.value > 0 ? value.spend / value.value : null,
    }))
    .sort((a, b) => b.spend - a.spend);
}

export function buildTrend(rows: FactRow[]): TrendPoint[] {
  const points = new Map<string, TrendPoint>();
  rows.forEach((row) => {
    const point = points.get(row.date) ?? { date: row.date, spend: 0, results: 0 };
    point.spend += row.spend;
    point.results += row.result_value;
    points.set(row.date, point);
  });
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function appendNode(target: Map<string, TreeNode>, id: string, name: string, level: TreeNode["level"], row: FactRow): TreeNode {
  const existing = target.get(id);
  if (existing) {
    existing.spend += row.spend;
    existing.result += row.result_value;
    existing.cost = existing.result > 0 ? existing.spend / existing.result : null;
    if (row.effective_status === "ACTIVE") existing.status = "ACTIVE";
    return existing;
  }
  const node: TreeNode = {
    id,
    name,
    level,
    group: row.result_group,
    spend: row.spend,
    result: row.result_value,
    cost: row.result_value > 0 ? row.spend / row.result_value : null,
    status: row.effective_status ?? "UNKNOWN",
    actionType: row.result_action_type,
    children: [],
  };
  target.set(id, node);
  return node;
}

export function buildTree(rows: FactRow[], sortBy: "spend" | "cost"): TreeNode[] {
  const campaigns = new Map<string, TreeNode>();
  const adsetsByCampaign = new Map<string, Map<string, TreeNode>>();
  const adsByAdset = new Map<string, Map<string, TreeNode>>();

  rows.forEach((row) => {
    const campaign = appendNode(campaigns, row.campaign_id, row.campaign_name, "campaign", row);
    let adsets = adsetsByCampaign.get(campaign.id);
    if (!adsets) {
      adsets = new Map();
      adsetsByCampaign.set(campaign.id, adsets);
    }
    const adset = appendNode(adsets, row.adset_id, row.adset_name, "adset", row);
    let ads = adsByAdset.get(adset.id);
    if (!ads) {
      ads = new Map();
      adsByAdset.set(adset.id, ads);
    }
    appendNode(ads, row.ad_id, row.ad_name, "ad", row);
  });

  const sortNodes = (nodes: TreeNode[]) =>
    nodes.sort((a, b) => (sortBy === "spend" ? b.spend - a.spend : (b.cost ?? 0) - (a.cost ?? 0)));

  campaigns.forEach((campaign) => {
    campaign.children = sortNodes([...(adsetsByCampaign.get(campaign.id)?.values() ?? [])]);
    campaign.children.forEach((adset) => {
      adset.children = sortNodes([...(adsByAdset.get(adset.id)?.values() ?? [])]);
    });
  });

  return sortNodes([...campaigns.values()]);
}

