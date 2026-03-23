export type MaterialStatus = "unmined" | "mined" | "failed";

export const columns = [
    { name: "标题 / 原文链接", uid: "title" },
    { name: "来源平台", uid: "platform" },
    { name: "原作者", uid: "author" },
    { name: "互动数据", uid: "engagement" },
    { name: "采集时间", uid: "collectDate", sortDirection: "descending" },
    { name: "挖掘状态", uid: "status" },
    { name: "高频关键词", uid: "keywords" },
    { name: "操作", uid: "actions" },
];

export const statusMap: Record<
    MaterialStatus,
    { label: string; color: "success" | "warning" | "danger" | "default" | "primary" | "secondary" }
> = {
    unmined: { label: "待挖掘", color: "success" },
    mined: { label: "已挖掘", color: "default" },
    failed: { label: "不具潜力(已放弃)", color: "danger" },
};
