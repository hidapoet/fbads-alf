export type Period = "realtime" | "daily" | "weekly" | "monthly";

export type ResultGroup =
  | "Inbox"
  | "Engage"
  | "Lead"
  | "Click"
  | "View"
  | "Reach"
  | "Sales"
  | "Recall";

export interface FactRow {
  date: string;
  granularity: "realtime" | "daily";
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  objective: string | null;
  optimization_goal: string | null;
  result_group: ResultGroup;
  result_action_type: string | null;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number | null;
  clicks_link: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  result_value: number;
  cost_per_result: number | null;
  effective_status: string | null;
  updated_at: string;
}

export interface DashboardResponse {
  rows: FactRow[];
  source: "supabase" | "mcp" | "unavailable" | "demo";
  message: string;
  syncedAt: string;
  connection: {
    supabase: boolean;
    meta: boolean;
  };
}
