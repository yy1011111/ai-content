"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Button,
    Card,
    CardBody,
    CardHeader,
    Chip,
    Input,
    Modal,
    ModalBody,
    ModalContent,
    ModalFooter,
    ModalHeader,
    Spinner,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableColumn,
    TableHeader,
    TableRow,
    Textarea,
    addToast,
    useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { contentStrategiesApi, type ContentStrategy, type ContentStrategyPayload } from "@/lib/api/content-strategies";
import { sourcesApi, type Source } from "@/lib/api/settings";

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "未知错误";
}

type StrategyFormState = ContentStrategyPayload;

const createInitialFormState = (): StrategyFormState => ({
    name: "",
    description: "",
    industry: "通用",
    targetAudience: "",
    commercialGoal: "",
    corePainPoints: "",
    writingAngles: "",
    toneAndStyle: "",
    sourceIds: [],
    enabled: true,
    isDefault: false,
});

export default function StrategiesPage() {
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [strategies, setStrategies] = useState<ContentStrategy[]>([]);
    const [sources, setSources] = useState<Source[]>([]);
    const [editingStrategy, setEditingStrategy] = useState<ContentStrategy | null>(null);
    const [formData, setFormData] = useState<StrategyFormState>(createInitialFormState());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const sourceNameMap = useMemo(
        () => Object.fromEntries(sources.map((source) => [source.id, source.name])),
        [sources],
    );

    const fetchPageData = useCallback(async () => {
        try {
            setLoading(true);
            const [strategyData, sourceData] = await Promise.all([
                contentStrategiesApi.list(),
                sourcesApi.list(),
            ]);
            setStrategies(strategyData);
            setSources(sourceData);
        } catch (error: unknown) {
            addToast({
                title: "加载内容策略失败",
                description: getErrorMessage(error),
                color: "danger",
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPageData();
    }, [fetchPageData]);

    const resetForm = () => {
        setEditingStrategy(null);
        setFormData(createInitialFormState());
    };

    const handleCloseModal = () => {
        onClose();
        resetForm();
    };

    const handleOpenCreate = () => {
        resetForm();
        onOpen();
    };

    const handleOpenEdit = (strategy: ContentStrategy) => {
        setEditingStrategy(strategy);
        setFormData({
            name: strategy.name,
            description: strategy.description || "",
            industry: strategy.industry,
            targetAudience: strategy.targetAudience,
            commercialGoal: strategy.commercialGoal,
            corePainPoints: strategy.corePainPoints,
            writingAngles: strategy.writingAngles,
            toneAndStyle: strategy.toneAndStyle || "",
            sourceIds: strategy.sourceIds || [],
            enabled: strategy.enabled,
            isDefault: strategy.isDefault,
        });
        onOpen();
    };

    const toggleSource = (sourceId: string, selected: boolean) => {
        setFormData((prev) => {
            const current = new Set(prev.sourceIds || []);
            if (selected) {
                current.add(sourceId);
            } else {
                current.delete(sourceId);
            }

            return {
                ...prev,
                sourceIds: Array.from(current),
            };
        });
    };

    const handleSave = async () => {
        if (
            !formData.name?.trim() ||
            !formData.targetAudience.trim() ||
            !formData.commercialGoal.trim() ||
            !formData.corePainPoints.trim() ||
            !formData.writingAngles.trim()
        ) {
            addToast({ title: "请补全必填项", color: "warning" });
            return;
        }

        try {
            setSaving(true);
            if (editingStrategy) {
                await contentStrategiesApi.update(editingStrategy.id, formData);
            } else {
                await contentStrategiesApi.create(formData);
            }
            addToast({ title: "内容策略已保存", color: "success" });
            handleCloseModal();
            await fetchPageData();
        } catch (error: unknown) {
            addToast({
                title: "保存失败",
                description: getErrorMessage(error),
                color: "danger",
            });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (strategy: ContentStrategy) => {
        if (!confirm(`确定删除内容策略“${strategy.name}”吗？`)) {
            return;
        }

        try {
            await contentStrategiesApi.remove(strategy.id);
            addToast({ title: "内容策略已删除", color: "success" });
            await fetchPageData();
        } catch (error: unknown) {
            addToast({
                title: "删除失败",
                description: getErrorMessage(error),
                color: "danger",
            });
        }
    };

    const handleSetDefault = async (strategy: ContentStrategy) => {
        try {
            await contentStrategiesApi.setDefault(strategy.id);
            addToast({ title: `已切换默认策略为“${strategy.name}”`, color: "success" });
            await fetchPageData();
        } catch (error: unknown) {
            addToast({
                title: "切换默认策略失败",
                description: getErrorMessage(error),
                color: "danger",
            });
        }
    };

    const renderSourceSummary = (strategy: ContentStrategy) => {
        if (!strategy.sourceIds || strategy.sourceIds.length === 0) {
            return <span className="text-small text-default-400">未绑定，默认使用全部已启用采集源</span>;
        }

        return (
            <div className="flex flex-wrap gap-1">
                {strategy.sourceIds.map((sourceId) => (
                    <Chip key={sourceId} size="sm" variant="flat" color="secondary">
                        {sourceNameMap[sourceId] || "已删除采集源"}
                    </Chip>
                ))}
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-6 max-w-6xl mx-auto w-full pb-10">
            <header className="rounded-medium border-small border-white/10 flex items-center justify-between gap-3 p-5 bg-background/60 backdrop-blur-md shadow-sm">
                <div className="flex flex-col">
                    <h2 className="text-xl text-default-900 font-bold">内容策略</h2>
                    <span className="text-small text-default-500 mt-1">
                        现在可以给每套策略单独绑定采集源，公众号和小红书能吃不同的素材池。
                    </span>
                </div>
                <Button color="primary" startContent={<Icon icon="solar:add-circle-bold" />} onClick={handleOpenCreate}>
                    添加策略
                </Button>
            </header>

            <Card className="bg-background/60 dark:bg-content1/80 backdrop-blur-md shadow-medium border-small border-white/10">
                <CardHeader className="px-6 pt-6 pb-2 flex flex-col items-start gap-2">
                    <h3 className="text-medium font-bold text-default-900">策略列表</h3>
                    <p className="text-small text-default-500">
                        默认策略会直接影响“精选选题库”的自动挖题和智能挖题。
                    </p>
                </CardHeader>
                <CardBody className="px-6 pb-6">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Spinner size="lg" />
                        </div>
                    ) : (
                        <Table aria-label="内容策略列表" className="border-small border-divider rounded-medium">
                            <TableHeader>
                                <TableColumn>策略名称</TableColumn>
                                <TableColumn>行业</TableColumn>
                                <TableColumn>绑定采集源</TableColumn>
                                <TableColumn>状态</TableColumn>
                                <TableColumn align="center">操作</TableColumn>
                            </TableHeader>
                            <TableBody emptyContent="暂无内容策略">
                                {strategies.map((strategy) => (
                                    <TableRow key={strategy.id}>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-default-900">{strategy.name}</span>
                                                    {strategy.isDefault ? (
                                                        <Chip size="sm" color="success" variant="flat">默认</Chip>
                                                    ) : null}
                                                </div>
                                                <span className="text-small text-default-500 line-clamp-2">
                                                    {strategy.description || "未填写说明"}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>{strategy.industry}</TableCell>
                                        <TableCell>{renderSourceSummary(strategy)}</TableCell>
                                        <TableCell>
                                            <Chip size="sm" color={strategy.enabled ? "primary" : "default"} variant="flat">
                                                {strategy.enabled ? "启用中" : "已禁用"}
                                            </Chip>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center justify-center gap-2">
                                                {!strategy.isDefault && strategy.enabled ? (
                                                    <Button size="sm" variant="light" color="success" onClick={() => handleSetDefault(strategy)}>
                                                        设为默认
                                                    </Button>
                                                ) : null}
                                                <Button isIconOnly size="sm" variant="light" onClick={() => handleOpenEdit(strategy)}>
                                                    <Icon icon="solar:pen-linear" width={18} />
                                                </Button>
                                                <Button
                                                    isIconOnly
                                                    size="sm"
                                                    variant="light"
                                                    color="danger"
                                                    isDisabled={strategy.isDefault}
                                                    onClick={() => handleDelete(strategy)}
                                                >
                                                    <Icon icon="solar:trash-bin-trash-linear" width={18} />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardBody>
            </Card>

            <Modal isOpen={isOpen} onClose={handleCloseModal} size="4xl" scrollBehavior="inside">
                <ModalContent>
                    <ModalHeader>{editingStrategy ? "编辑内容策略" : "新增内容策略"}</ModalHeader>
                    <ModalBody className="gap-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                                label="策略名称"
                                labelPlacement="outside"
                                placeholder="例如：公众号热点深度策略"
                                value={formData.name}
                                onValueChange={(value) => setFormData((prev) => ({ ...prev, name: value }))}
                            />
                            <Input
                                label="所属行业"
                                labelPlacement="outside"
                                placeholder="例如：公众号内容创作 / 热点评论"
                                value={formData.industry || ""}
                                onValueChange={(value) => setFormData((prev) => ({ ...prev, industry: value }))}
                            />
                        </div>

                        <Textarea
                            label="策略说明"
                            labelPlacement="outside"
                            minRows={2}
                            placeholder="简要说明这套策略适用于什么内容"
                            value={formData.description || ""}
                            onValueChange={(value) => setFormData((prev) => ({ ...prev, description: value }))}
                        />

                        <Textarea
                            label="目标人群"
                            labelPlacement="outside"
                            minRows={3}
                            placeholder="例如：关注社会热点、公共事件、生活议题的公众号读者"
                            value={formData.targetAudience}
                            onValueChange={(value) => setFormData((prev) => ({ ...prev, targetAudience: value }))}
                        />

                        <Textarea
                            label="商业目标"
                            labelPlacement="outside"
                            minRows={3}
                            placeholder="例如：提升阅读量、转发率和读者粘性"
                            value={formData.commercialGoal}
                            onValueChange={(value) => setFormData((prev) => ({ ...prev, commercialGoal: value }))}
                        />

                        <Textarea
                            label="核心痛点"
                            labelPlacement="outside"
                            minRows={3}
                            placeholder="例如：热点很多但不会筛选，不知道如何写出观点和传播性"
                            value={formData.corePainPoints}
                            onValueChange={(value) => setFormData((prev) => ({ ...prev, corePainPoints: value }))}
                        />

                        <Textarea
                            label="建议切入角度"
                            labelPlacement="outside"
                            minRows={3}
                            placeholder="例如：事件脉络梳理、争议点拆解、情绪观察、普通人影响"
                            value={formData.writingAngles}
                            onValueChange={(value) => setFormData((prev) => ({ ...prev, writingAngles: value }))}
                        />

                        <Textarea
                            label="语气与风格"
                            labelPlacement="outside"
                            minRows={2}
                            placeholder="例如：清晰、有观点、有情绪张力，但不过度夸张"
                            value={formData.toneAndStyle || ""}
                            onValueChange={(value) => setFormData((prev) => ({ ...prev, toneAndStyle: value }))}
                        />

                        <div className="rounded-large border border-default-200 px-4 py-4 flex flex-col gap-3">
                            <div>
                                <p className="text-sm font-medium text-default-700">绑定采集源</p>
                                <p className="text-xs text-default-400 mt-1">
                                    绑定后，这套策略挖题时只会优先使用这些采集源；不绑定则使用全部已启用采集源。
                                </p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {sources.map((source) => {
                                    const selected = (formData.sourceIds || []).includes(source.id);
                                    return (
                                        <div key={source.id} className="flex items-center justify-between rounded-medium border border-default-200 px-3 py-3">
                                            <div className="min-w-0 pr-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium truncate">{source.name}</span>
                                                    <Chip size="sm" variant="flat" color="primary">
                                                        {source.type}
                                                    </Chip>
                                                </div>
                                                <p className="text-xs text-default-400 truncate mt-1">{source.url}</p>
                                            </div>
                                            <Switch
                                                isSelected={selected}
                                                onValueChange={(value) => toggleSource(source.id, value)}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-large border border-default-200 px-4 py-3">
                            <div>
                                <p className="text-sm font-medium text-default-700">启用该策略</p>
                                <p className="text-xs text-default-400 mt-1">禁用后不能被设为默认，也不会参与系统自动挖题。</p>
                            </div>
                            <Switch
                                isSelected={formData.enabled ?? true}
                                onValueChange={(value) => setFormData((prev) => ({ ...prev, enabled: value }))}
                            />
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="light" onClick={handleCloseModal}>取消</Button>
                        <Button color="primary" isLoading={saving} onClick={handleSave}>保存策略</Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    );
}
