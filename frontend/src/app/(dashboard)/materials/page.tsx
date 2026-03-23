"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
    Table,
    TableHeader,
    TableColumn,
    TableBody,
    TableRow,
    TableCell,
    Input,
    Button,
    Chip,
    Pagination,
    Tooltip,
    Selection,
    SortDescriptor,
    Select,
    SelectItem,
    Spinner,
    addToast,
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { columns, statusMap } from "./data";
import { materialsApi, Material, XiaohongshuSortType, XiaohongshuTimeRangeType } from "@/lib/api/materials";
import ReactMarkdown from "react-markdown";

export default function MaterialsPage() {
    const [filterValue, setFilterValue] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [platformFilter, setPlatformFilter] = useState("all");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set([]));
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
        column: "collectDate",
        direction: "descending",
    });
    const [isCollecting, setIsCollecting] = useState(false);
    const [isXiaohongshuLoggingIn, setIsXiaohongshuLoggingIn] = useState(false);
    const [isXiaohongshuCollecting, setIsXiaohongshuCollecting] = useState(false);
    const [isMounted, setIsMounted] = useState(false);
    const [xiaohongshuKeyword, setXiaohongshuKeyword] = useState("");
    const [xiaohongshuSort, setXiaohongshuSort] = useState<XiaohongshuSortType>("general");
    const [xiaohongshuTimeRange, setXiaohongshuTimeRange] = useState<XiaohongshuTimeRangeType>("7d");

    // 鏈嶅姟绔暟鎹姸鎬?
    const [items, setItems] = useState<Material[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [platforms, setPlatforms] = useState<{ platform: string; count: number }[]>([]);
    const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
    const { isOpen, onOpen, onClose } = useDisclosure();

    // 鐢ㄤ簬鎼滅储闃叉姈鐨勮鏃跺櫒
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 浠庢湇鍔＄鑾峰彇鏁版嵁
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            // 鏋勫缓鎺掑簭瀛楁鏄犲皠
            const sortBy = sortDescriptor.column as string;
            const sortOrder = sortDescriptor.direction === "descending" ? "desc" : "asc";

            const [result, stats] = await Promise.all([
                materialsApi.list({
                    page,
                    limit: rowsPerPage,
                    keyword: filterValue || undefined,
                    status: statusFilter !== "all" ? statusFilter : undefined,
                    platform: platformFilter !== "all" ? platformFilter : undefined,
                    category: categoryFilter !== "all" ? categoryFilter : undefined,
                    sortBy,
                    sortOrder,
                }),
                materialsApi.stats()
            ]);

            setItems(result.items);
            setTotal(result.total);
            setTotalPages(result.totalPages);
            setPlatforms(stats.byPlatform);
        } catch (e: any) {
            addToast({ title: "加载素材失败", description: e.message, color: "danger" });
        } finally {
            setIsLoading(false);
        }
    }, [page, rowsPerPage, filterValue, statusFilter, platformFilter, categoryFilter, sortDescriptor]);

    // 绛涢€夋潯浠跺彉鍖栨椂閲嶆柊璇锋眰
    useEffect(() => {
        setIsMounted(true);
        fetchData();
    }, [fetchData]);

    // 鎼滅储杈撳叆闃叉姈澶勭悊
    const onSearchChange = useCallback((value?: string) => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
            setFilterValue(value || "");
            setPage(1);
        }, 300);
    }, []);

    // 绛涢€夋潯浠跺彉鍖栨椂閲嶇疆椤电爜
    const handleStatusChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setStatusFilter(e.target.value);
        setPage(1);
    }, []);

    const handlePlatformChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setPlatformFilter(e.target.value);
        setPage(1);
    }, []);

    const handleCategoryChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setCategoryFilter(e.target.value);
        setPage(1);
    }, []);

    // 瑙﹀彂鑷姩閲囬泦浠诲姟
    const handleCollect = useCallback(async () => {
        setIsCollecting(true);
        try {
            const result = await materialsApi.collect();
            addToast({ title: "采集任务已启动", description: result.message, color: "success" });
            // 采集完成后刷新列表
            await fetchData();
        } catch (e: any) {
            addToast({ title: "采集失败", description: e.message, color: "danger" });
        } finally {
            setIsCollecting(false);
        }
    }, [fetchData]);

    const handleXiaohongshuLogin = useCallback(async () => {
        setIsXiaohongshuLoggingIn(true);
        try {
            const result = await materialsApi.loginXiaohongshu();
            addToast({
                title: result.success ? "登录状态可用" : "登录未完成",
                description: result.message,
                color: result.success ? "success" : "warning",
            });
        } catch (e: any) {
            addToast({ title: "打开登录窗口失败", description: e.message, color: "danger" });
        } finally {
            setIsXiaohongshuLoggingIn(false);
        }
    }, []);

    const handleXiaohongshuKeywordCollect = useCallback(async () => {
        const keyword = xiaohongshuKeyword.trim();
        if (!keyword) {
            addToast({ title: "请输入关键词", description: "例如：早春穿搭 / 小个子 ootd / 黄黑皮口红", color: "warning" });
            return;
        }

        setIsXiaohongshuCollecting(true);
        try {
            const result = await materialsApi.collectXiaohongshuKeyword(keyword, 12, xiaohongshuSort, xiaohongshuTimeRange);
            addToast({ title: "小红书关键词采集完成", description: result.message, color: "success" });
            setCategoryFilter("xiaohongshu_reference");
            setPlatformFilter("Xiaohongshu");
            setPage(1);
            await fetchData();
        } catch (e: any) {
            addToast({ title: "小红书关键词采集失败", description: e.message, color: "danger" });
        } finally {
            setIsXiaohongshuCollecting(false);
        }
    }, [fetchData, xiaohongshuKeyword, xiaohongshuSort, xiaohongshuTimeRange]);

    // 鎵归噺鍒犻櫎
    const handleBulkDelete = useCallback(async () => {
        const ids = selectedKeys === "all"
            ? items.map(item => item.id)
            : Array.from(selectedKeys) as string[];

        if (ids.length === 0) return;

        try {
            const result = await materialsApi.batchRemove(ids);
            addToast({ title: "批量删除成功", description: `已删除 ${result.deleted} 条素材`, color: "success" });
            setSelectedKeys(new Set([]));
            await fetchData();
        } catch (e: any) {
            addToast({ title: "批量删除失败", description: e.message, color: "danger" });
        }
    }, [selectedKeys, items, fetchData]);

    // 鍗曟潯鍒犻櫎
    const handleDelete = useCallback(async (id: string) => {
        try {
            await materialsApi.remove(id);
            addToast({ title: "删除成功", color: "success" });
            await fetchData();
        } catch (e: any) {
            addToast({ title: "删除失败", description: e.message, color: "danger" });
        }
    }, [fetchData]);

    // 鏌ョ湅璇︽儏
    const handleView = useCallback((item: Material) => {
        setSelectedMaterial(item);
        onOpen();
    }, [onOpen]);

    const platformDisplayNameMap: Record<string, string> = {
        "36Kr": "36氪",
        "HubToday": "HubToday",
        "Juejin": "掘金",
        "Zhihu": "知乎",
        "WeChat": "微信公众号",
        "V2EX": "V2EX",
        "X/Twitter": "X (Twitter)",
        "Tophub": "今日热榜",
        "Xiaohongshu": "小红书",
    };

    const categoryLabelMap: Record<string, string> = {
        xiaohongshu_reference: "小红书参考",
        external_trend: "外部热点",
    };

    const renderSignalValue = (value?: string | null) => value || "-";

    const parseSignalValue = (value?: string | null) => {
        if (!value) return 0;
        const normalized = value.replace(/,/g, "").trim().toLowerCase();
        if (!normalized) return 0;
        if (normalized.endsWith("w") || normalized.endsWith("万")) {
            return (Number.parseFloat(normalized.slice(0, -1)) || 0) * 10000;
        }
        if (normalized.endsWith("k") || normalized.endsWith("千")) {
            return (Number.parseFloat(normalized.slice(0, -1)) || 0) * 1000;
        }
        return Number.parseFloat(normalized) || 0;
    };

    const signalTone = (value?: string | null) => {
        const score = parseSignalValue(value);
        if (score >= 1000) return "danger" as const;
        if (score >= 300) return "warning" as const;
        if (score > 0) return "secondary" as const;
        return "default" as const;
    };

    const renderCell = useCallback((item: Material, columnKey: React.Key) => {
        const cellValue = item[columnKey as keyof Material];

        switch (columnKey) {
            case "title":
                return (
                    <div className="flex flex-col gap-1 max-w-[300px]">
                        <span className="text-small text-default-900 truncate font-medium">{item.title}</span>
                        <div className="flex flex-wrap gap-1">
                            {item.metadata?.materialCategory && (
                                <Chip size="sm" variant="flat" color="secondary" className="text-tiny h-5">
                                    {categoryLabelMap[item.metadata.materialCategory] || item.metadata.materialCategory}
                                </Chip>
                            )}
                            {item.metadata?.referenceKeyword && (
                                <Chip size="sm" variant="flat" color="warning" className="text-tiny h-5">
                                    关键词：{item.metadata.referenceKeyword}
                                </Chip>
                            )}
                            {item.metadata?.timeRangeLabel && (
                                <Chip size="sm" variant="flat" color="primary" className="text-tiny h-5">
                                    {item.metadata.timeRangeLabel}
                                </Chip>
                            )}
                        </div>
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-tiny text-primary truncate hover:underline">
                            {item.sourceUrl}
                        </a>
                    </div>
                );
            case "platform":
                return (
                    <Chip size="sm" variant="flat" className="capitalize bg-default-100 text-default-800">
                        {platformDisplayNameMap[item.platform] || item.platform}
                    </Chip>
                );
            case "engagement":
                if (!item.metadata?.signal) {
                    return <span className="text-small text-default-400">-</span>;
                }

                return (
                    <div className="flex flex-wrap gap-1 max-w-[170px]">
                        <Chip size="sm" variant="flat" color={signalTone(item.metadata.signal.likeCount)} className="text-tiny">
                            赞 {renderSignalValue(item.metadata.signal.likeCount)}
                        </Chip>
                        <Chip size="sm" variant="flat" color={signalTone(item.metadata.signal.collectCount)} className="text-tiny">
                            藏 {renderSignalValue(item.metadata.signal.collectCount)}
                        </Chip>
                        <Chip size="sm" variant="flat" color={signalTone(item.metadata.signal.commentCount)} className="text-tiny">
                            评 {renderSignalValue(item.metadata.signal.commentCount)}
                        </Chip>
                    </div>
                );
            case "status":
                const statusConfig = statusMap[item.status];
                return (
                    <Chip size="sm" variant="flat" color={statusConfig.color}>
                        {statusConfig.label}
                    </Chip>
                );
            case "keywords":
                return (
                    <div className="flex gap-1 flex-wrap">
                        {item.keywords.map((kw, idx) => {
                            const colors: ("primary" | "secondary" | "success" | "warning" | "danger" | "default")[] = [
                                "primary", "secondary", "success", "warning", "default"
                            ];
                            const color = colors[idx % colors.length];
                            return (
                                <Chip key={idx} size="sm" variant="flat" color={color} className="text-tiny h-5">
                                    {kw}
                                </Chip>
                            );
                        })}
                    </div>
                );
            case "collectDate":
                return (
                    <span className="text-small text-default-500">
                        {new Date(cellValue as string).toLocaleString("zh-CN", {
                            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                        })}
                    </span>
                );
            case "actions":
                return (
                    <div className="flex items-center gap-2">
                        <Tooltip content="查看详情">
                            <Button isIconOnly size="sm" variant="light" onClick={() => handleView(item)}>
                                <Icon icon="solar:eye-linear" width={18} />
                            </Button>
                        </Tooltip>
                        <Tooltip content="删除素材" color="danger">
                            <Button isIconOnly size="sm" variant="light" color="danger" onClick={() => handleDelete(item.id)}>
                                <Icon icon="solar:trash-bin-trash-linear" width={18} />
                            </Button>
                        </Tooltip>
                    </div>
                );
            default:
                return null;
        }
    }, [handleDelete]);

    const topContent = (
        <div className="flex flex-col gap-4 mb-2">
            <div className="flex justify-between gap-3 items-end">
                <div className="flex items-center gap-3 w-full flex-wrap">
                    <Input
                        isClearable
                        classNames={{
                            base: "w-full sm:max-w-[240px]",
                            mainWrapper: "h-full",
                            input: "text-small",
                            inputWrapper: "h-full font-normal text-default-500 bg-default-400/20 dark:bg-default-500/20 backdrop-blur-md",
                        }}
                        size="sm"
                        placeholder="搜索素材标题..."
                        startContent={<Icon icon="solar:magnifer-linear" className="text-default-300" />}
                        defaultValue={filterValue}
                        onClear={() => {
                            setFilterValue("");
                            setPage(1);
                        }}
                        onValueChange={onSearchChange}
                    />
                    <Select
                        className="w-[120px]"
                        size="sm"
                        selectedKeys={[statusFilter]}
                        onChange={handleStatusChange}
                        aria-label="挖掘状态"
                    >
                        <SelectItem key="all">全部状态</SelectItem>
                        <SelectItem key="unmined">待挖掘</SelectItem>
                        <SelectItem key="mined">已挖掘</SelectItem>
                        <SelectItem key="failed">采集失败</SelectItem>
                    </Select>
                    <Select
                        className="w-[160px]"
                        size="sm"
                        selectedKeys={[platformFilter]}
                        onChange={handlePlatformChange}
                        aria-label="来源平台"
                    >
                        {[
                            <SelectItem key="all">全部平台</SelectItem>,
                            ...platforms.map((p) => (
                                <SelectItem key={p.platform}>
                                    {platformDisplayNameMap[p.platform] || p.platform}
                                </SelectItem>
                            ))
                        ]}
                    </Select>
                    <Select
                        className="w-[160px]"
                        size="sm"
                        selectedKeys={[categoryFilter]}
                        onChange={handleCategoryChange}
                        aria-label="素材类别"
                    >
                        <SelectItem key="all">全部类别</SelectItem>
                        <SelectItem key="xiaohongshu_reference">小红书参考</SelectItem>
                        <SelectItem key="external_trend">外部热点</SelectItem>
                    </Select>
                    {(selectedKeys === "all" || (selectedKeys as Set<string>).size > 0) && (
                        <Button
                            size="sm"
                            color="danger"
                            variant="flat"
                            startContent={<Icon icon="solar:trash-bin-trash-bold" width={16} />}
                            onClick={handleBulkDelete}
                        >
                            批量删除 ({selectedKeys === "all" ? items.length : (selectedKeys as Set<string>).size})
                        </Button>
                    )}
                </div>

                <div className="flex gap-3 shrink-0">
                    <Input
                        classNames={{
                            base: "w-[220px]",
                            input: "text-small",
                            inputWrapper: "bg-default-400/20 dark:bg-default-500/20 backdrop-blur-md",
                        }}
                        size="sm"
                        placeholder="小红书关键词，如：早春穿搭"
                        value={xiaohongshuKeyword}
                        onValueChange={setXiaohongshuKeyword}
                    />
                    <Select
                        className="w-[160px]"
                        size="sm"
                        selectedKeys={[xiaohongshuSort]}
                        onSelectionChange={(keys) => {
                            const selected = Array.from(keys)[0] as XiaohongshuSortType | undefined;
                            if (selected) {
                                setXiaohongshuSort(selected);
                            }
                        }}
                        aria-label="小红书排序方式"
                        disallowEmptySelection
                    >
                        <SelectItem key="general">综合推荐</SelectItem>
                        <SelectItem key="popularity_descending">最多点赞</SelectItem>
                        <SelectItem key="collect_descending">最多收藏</SelectItem>
                        <SelectItem key="comment_descending">最多评论</SelectItem>
                        <SelectItem key="time_descending">最新</SelectItem>
                    </Select>
                    <Select
                        className="w-[140px]"
                        size="sm"
                        selectedKeys={[xiaohongshuTimeRange]}
                        onSelectionChange={(keys) => {
                            const selected = Array.from(keys)[0] as XiaohongshuTimeRangeType | undefined;
                            if (selected) {
                                setXiaohongshuTimeRange(selected);
                            }
                        }}
                        aria-label="小红书时间范围"
                        disallowEmptySelection
                    >
                        <SelectItem key="1d">1天内</SelectItem>
                        <SelectItem key="7d">7天内</SelectItem>
                        <SelectItem key="30d">30天内</SelectItem>
                        <SelectItem key="all">不限</SelectItem>
                    </Select>
                    <Button
                        color="secondary"
                        variant="flat"
                        size="sm"
                        isLoading={isXiaohongshuLoggingIn}
                        onClick={handleXiaohongshuLogin}
                    >
                        登录小红书
                    </Button>
                    <Button
                        color="secondary"
                        size="sm"
                        startContent={<Icon icon="solar:fire-linear" width={18} />}
                        isLoading={isXiaohongshuCollecting}
                        onClick={handleXiaohongshuKeywordCollect}
                    >
                        关键词采集
                    </Button>
                    <Button
                        color="primary"
                        size="sm"
                        startContent={<Icon icon="solar:cloud-download-linear" width={18} />}
                        isLoading={isCollecting}
                        onClick={handleCollect}
                    >
                        自动采集任务
                    </Button>
                </div>
            </div>
            <div className="flex justify-between items-center">
                <span className="text-default-400 text-small">总共 {total} 个储备素材</span>
                <label className="flex items-center text-default-400 text-small">
                    每页显示:
                    <select
                        className="bg-transparent outline-none text-default-400 text-small ml-1"
                        value={rowsPerPage.toString()}
                        onChange={(e) => {
                            setRowsPerPage(Number(e.target.value));
                            setPage(1);
                        }}
                    >
                        <option value="10">10</option>
                        <option value="20">20</option>
                        <option value="50">50</option>
                    </select>
                </label>
            </div>
        </div>
    );

    const bottomContent = (
        <div className="py-4 px-2 flex justify-center items-center w-full">
            <Pagination
                isCompact
                showControls
                showShadow
                color="primary"
                page={page}
                total={totalPages || 1}
                onChange={setPage}
            />
        </div>
    );

    return (
        <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10">
            <header className="rounded-medium border-small border-white/10 flex items-center justify-between gap-3 p-5 bg-background/60 backdrop-blur-md shadow-sm">
                <div className="flex flex-col">
                    <h2 className="text-xl text-default-900 font-bold">源素材库</h2>
                    <span className="text-small text-default-500 mt-1">管理从全网各个平台自动抓取的未加工图文内容，作为后续智能选题和内容创作的素材池。</span>
                    <span className="text-tiny text-default-400 mt-2">小红书关键词采集首次使用前，请先点击“登录小红书”完成一次扫码授权。</span>
                </div>
            </header>

            {isMounted ? (
                <Table
                    aria-label="素材管理列表"
                    isHeaderSticky
                    bottomContent={bottomContent}
                    bottomContentPlacement="outside"
                    classNames={{
                        wrapper: "max-h-[calc(100vh-250px)] bg-content1 shadow-sm border-small border-white/10",
                    }}
                    selectedKeys={selectedKeys}
                    selectionMode="multiple"
                    sortDescriptor={sortDescriptor}
                    topContent={topContent}
                    topContentPlacement="outside"
                    onSelectionChange={(keys) => {
                        if (keys === "all") {
                            setSelectedKeys(new Set(items.map(item => item.id)));
                        } else {
                            setSelectedKeys(keys);
                        }
                    }}
                    onSortChange={(descriptor) => {
                        setSortDescriptor(descriptor);
                        setPage(1);
                    }}
                >
                    <TableHeader columns={columns}>
                        {(column) => (
                            <TableColumn
                                key={column.uid}
                                align={column.uid === "actions" ? "center" : "start"}
                                allowsSorting={column.uid !== "actions" && column.uid !== "keywords"}
                            >
                                {column.name}
                            </TableColumn>
                        )}
                    </TableHeader>
                    <TableBody
                        emptyContent={isLoading ? " " : "未找到符合条件的素材"}
                        items={items}
                        isLoading={isLoading}
                        loadingContent={<Spinner label="加载中..." />}
                    >
                        {(item) => (
                            <TableRow key={item.id}>
                                {(columnKey) => <TableCell>{renderCell(item, columnKey)}</TableCell>}
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            ) : (
                <div className="flex justify-center items-center py-20 min-h-[400px]">
                    <Spinner size="lg" label="加载中..." />
                </div>
            )}

            <Modal
                isOpen={isOpen}
                onClose={onClose}
                size="3xl"
                scrollBehavior="inside"
                backdrop="blur"
                classNames={{
                    base: "bg-background/80 backdrop-blur-md border-small border-white/10",
                    header: "border-b-small border-white/10",
                    footer: "border-t-small border-white/10",
                }}
            >
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader className="flex flex-col gap-1">
                                <h3 className="text-xl font-bold">{selectedMaterial?.title}</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <Chip size="sm" variant="flat">{selectedMaterial?.platform}</Chip>
                                    {selectedMaterial?.metadata?.materialCategory && (
                                        <Chip size="sm" variant="flat" color="secondary">
                                            {categoryLabelMap[selectedMaterial.metadata.materialCategory] || selectedMaterial.metadata.materialCategory}
                                        </Chip>
                                    )}
                                    {selectedMaterial?.metadata?.referenceKeyword && (
                                        <Chip size="sm" variant="flat" color="warning">
                                            关键词：{selectedMaterial.metadata.referenceKeyword}
                                        </Chip>
                                    )}
                                    <span className="text-tiny text-default-400">{selectedMaterial?.author}</span>
                                    <span className="text-tiny text-default-400">
                                        {selectedMaterial?.collectDate && new Date(selectedMaterial.collectDate).toLocaleString()}
                                    </span>
                                </div>
                            </ModalHeader>
                            <ModalBody className="py-6">
                                <div className="prose prose-sm dark:prose-invert max-w-none">
                                    <ReactMarkdown>
                                        {selectedMaterial?.content || "暂无正文内容"}
                                    </ReactMarkdown>
                                </div>
                                {selectedMaterial?.sourceUrl && (
                                    <div className="mt-6 pt-4 border-t-small border-white/5">
                                        <p className="text-tiny text-default-500 mb-1">原文链接：</p>
                                        <a
                                            href={selectedMaterial.sourceUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-small text-primary hover:underline break-all"
                                        >
                                            {selectedMaterial.sourceUrl}
                                        </a>
                                    </div>
                                )}
                            </ModalBody>
                            <ModalFooter>
                                <Button color="default" variant="flat" onClick={onClose}>
                                    关闭
                                </Button>
                                <Button
                                    color="primary"
                                    onClick={() => window.open(selectedMaterial?.sourceUrl, '_blank')}
                                >
                                    浏览原文
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>
        </div>
    );
}
