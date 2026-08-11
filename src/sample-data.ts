import type { FactRow, ResultGroup } from "./types";

const DAY = 86_400_000;
const now = new Date();

const campaigns = [
  {
    id: "cmp_inbox",
    name: "[ALF] Trà Thư Dạ - Tin nhắn",
    objective: "OUTCOME_ENGAGEMENT",
    goal: "CONVERSATIONS",
    group: "Inbox" as ResultGroup,
    action: "onsite_conversion.messaging_conversation_started_7d",
  },
  {
    id: "cmp_click",
    name: "Hunter | Shopee | Retargeting",
    objective: "OUTCOME_TRAFFIC",
    goal: "LINK_CLICKS",
    group: "Click" as ResultGroup,
    action: "link_click",
  },
  {
    id: "cmp_engage",
    name: "[ALF] Vườn thảo mộc - Tương tác",
    objective: "OUTCOME_ENGAGEMENT",
    goal: "POST_ENGAGEMENT",
    group: "Engage" as ResultGroup,
    action: "post_engagement",
  },
  {
    id: "cmp_view",
    name: "Quy trình sấy trà - Video",
    objective: "OUTCOME_AWARENESS",
    goal: "THRUPLAY",
    group: "View" as ResultGroup,
    action: "video_thruplay_watched",
  },
];

function isoDate(offset: number): string {
  return new Date(now.getTime() - offset * DAY).toISOString().slice(0, 10);
}

export const SAMPLE_ROWS: FactRow[] = Array.from({ length: 12 }, (_, index) => {
  const campaign = campaigns[index % campaigns.length];
  const dayOffset = Math.floor(index / campaigns.length);
  const factor = 1 + ((index * 17) % 29) / 100;
  const spend = Math.round((210_000 + (index % 4) * 95_000) * factor);
  const resultBase = campaign.group === "Engage" ? 1420 : campaign.group === "View" ? 610 : campaign.group === "Click" ? 126 : 4;
  const result = Math.round(resultBase * factor);
  const impressions = Math.round((12_800 + index * 950) * factor);
  const clicks = campaign.group === "Click" ? result : Math.round(impressions * 0.013);
  return {
    date: isoDate(dayOffset),
    granularity: dayOffset === 0 ? "realtime" : "daily",
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    adset_id: `${campaign.id}_set_${index % 2}`,
    adset_name: index % 2 === 0 ? "Tệp quan tâm thảo mộc" : "Retarget 30 ngày",
    ad_id: `${campaign.id}_ad_${index}`,
    ad_name: index % 2 === 0 ? "Nội dung chính" : "Biến thể hình ảnh",
    objective: campaign.objective,
    optimization_goal: campaign.goal,
    result_group: campaign.group,
    result_action_type: campaign.action,
    spend,
    impressions,
    reach: Math.round(impressions * 0.78),
    frequency: 1.08 + (index % 4) * 0.05,
    clicks_link: clicks,
    ctr: (clicks / impressions) * 100,
    cpc: clicks > 0 ? spend / clicks : null,
    cpm: (spend / impressions) * 1000,
    result_value: result,
    cost_per_result: result > 0 ? spend / result : null,
    effective_status: index % 5 === 0 ? "PAUSED" : "ACTIVE",
    updated_at: new Date(now.getTime() - index * 420_000).toISOString(),
  };
});

