"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
    addToast,
    Button,
    Card,
    Chip,
    Input,
    Modal,
    ModalBody,
    ModalContent,
    ModalFooter,
    ModalHeader,
    Spinner,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableColumn,
    TableHeader,
    TableRow,
    Tabs,
    Textarea,
    useDisclosure,
} from "@heroui/react";
import { Icon, loadIcons } from "@iconify/react";
import { stylesApi, Style, StyleType } from "@/lib/api/styles";

type StyleFormData = {
    name: string;
    description: string;
    promptTemplate: string;
    isDefault?: boolean;
    parameters?: Record<string, unknown>;
};

type StyleManagerProps = {
    type: StyleType;
    title: string;
    description: string;
    promptPlaceholder: string;
};

export default function StylesPage() {
    useEffect(() => {
        loadIcons([
            "solar:document-add-bold",
            "solar:pen-linear",
            "solar:trash-bin-trash-linear",
            "solar:add-circle-bold",
            "solar:star-bold",
            "solar:gallery-bold",
            "solar:chat-round-dots-bold",
            "solar:text-bold",
        ]);
    }, []);

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <header className="flex items-center justify-between gap-3 rounded-medium border-small border-divider bg-background p-4 shadow-sm">
                <div>
                    <h2 className="flex items-center gap-2 text-large font-bold text-default-900">
                        <Icon icon="solar:document-add-bold" className="text-primary" />
                        风格管理
                    </h2>
                    <p className="mt-1 text-small text-default-500">
                        在这里统一管理公众号正文主提示词、文章风格、小红书风格和图片风格。每种类型都只会生效一条默认配置。
                    </p>
                </div>
            </header>

            <Card className="border-small border-white/10 bg-background/60 shadow-medium backdrop-blur-md dark:bg-default-100/50">
                <Tabs
                    classNames={{
                        tabList: "mx-4 mt-6 bg-default-100/50 text-medium",
                        tabContent: "text-small",
                        panel: "p-6",
                    }}
                    size="lg"
                >
                    <Tab
                        key="article_system"
                        title={
                            <div className="flex items-center gap-2">
                                <Icon icon="solar:text-bold" width={20} />
                                <span>公众号主提示词</span>
                            </div>
                        }
                    >
                        <StyleManager
                            type="article_system"
                            title="公众号正文主提示词"
                            description="控制公众号正文主生成链的核心系统提示词。这里改的是主脑，不只是语气调味。"
                            promptPlaceholder="输入公众号正文主提示词。建议只写核心写作方法、读者定位、结构规则、语言禁忌和输出要求，不要把图片 URL 或具体素材写死。"
                        />
                    </Tab>

                    <Tab
                        key="article"
                        title={
                            <div className="flex items-center gap-2">
                                <Icon icon="solar:document-add-bold" width={20} />
                                <span>文章风格</span>
                            </div>
                        }
                    >
                        <StyleManager
                            type="article"
                            title="文章风格管理"
                            description="用于控制公众号文章的口吻、作者感、情绪强度和表达质感。"
                            promptPlaceholder="输入文章风格要求，例如：更像真人评论、更克制、更锋利、更适合公众号深度阅读。"
                        />
                    </Tab>

                    <Tab
                        key="xiaohongshu"
                        title={
                            <div className="flex items-center gap-2">
                                <Icon icon="solar:chat-round-dots-bold" width={20} />
                                <span>小红书笔记风格</span>
                            </div>
                        }
                    >
                        <StyleManager
                            type="xiaohongshu"
                            title="小红书笔记风格管理"
                            description="用于控制小红书笔记的语气、节奏、互动感和平台表达方式。"
                            promptPlaceholder="输入适合小红书的风格要求，例如：开头更抓人、短句、更口语化、更适合收藏和评论。"
                        />
                    </Tab>

                    <Tab
                        key="image"
                        title={
                            <div className="flex items-center gap-2">
                                <Icon icon="solar:gallery-bold" width={20} />
                                <span>图片风格</span>
                            </div>
                        }
                    >
                        <StyleManager
                            type="image"
                            title="图片风格管理"
                            description="用于控制封面图、正文配图和视觉生成时的总体画面风格。"
                            promptPlaceholder="输入图片风格要求，例如：更克制、更真实、更像公众号头图，禁止文字水印和平台感。"
                        />
                    </Tab>
                </Tabs>
            </Card>
        </div>
    );
}

function StyleManager({ type, title, description, promptPlaceholder }: StyleManagerProps) {
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [styles, setStyles] = useState<Style[]>([]);
    const [editingStyle, setEditingStyle] = useState<Style | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchStyles = useCallback(async () => {
        try {
            setLoading(true);
            const data = await stylesApi.list(type);
            setStyles(data);
        } catch (error: unknown) {
            addToast({
                title: "加载失败",
                description: error instanceof Error ? error.message : "未知错误",
                color: "danger",
            });
        } finally {
            setLoading(false);
        }
    }, [type]);

    useEffect(() => {
        fetchStyles();
    }, [fetchStyles]);

    const handleAdd = () => {
        setEditingStyle(null);
        onOpen();
    };

    const handleEdit = (style: Style) => {
        setEditingStyle(style);
        onOpen();
    };

    const handleDelete = async (id: string) => {
        try {
            await stylesApi.remove(id);
            setStyles((current) => current.filter((item) => item.id !== id));
            addToast({ title: "删除成功", color: "success" });
        } catch (error: unknown) {
            addToast({
                title: "删除失败",
                description: error instanceof Error ? error.message : "未知错误",
                color: "danger",
            });
        }
    };

    const handleSetDefault = async (id: string) => {
        try {
            await stylesApi.setDefault(id);
            await fetchStyles();
            addToast({ title: "已设为默认", color: "success" });
        } catch (error: unknown) {
            addToast({
                title: "设置失败",
                description: error instanceof Error ? error.message : "未知错误",
                color: "danger",
            });
        }
    };

    const handleSave = async (formData: StyleFormData) => {
        try {
            if (editingStyle) {
                await stylesApi.update(editingStyle.id, { ...formData, type });
            } else {
                await stylesApi.create({ ...formData, type });
            }
            onClose();
            await fetchStyles();
            addToast({ title: "保存成功", color: "success" });
        } catch (error: unknown) {
            addToast({
                title: "保存失败",
                description: error instanceof Error ? error.message : "未知错误",
                color: "danger",
            });
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="mb-2 flex items-center justify-between">
                <div>
                    <h3 className="text-medium font-bold">{title}</h3>
                    <p className="mt-1 text-small text-default-500">{description}</p>
                </div>
                <Button color="primary" startContent={<Icon icon="solar:add-circle-bold" />} onClick={handleAdd}>
                    添加配置
                </Button>
            </div>

            <Table aria-label={`${title}列表`} className="rounded-medium border-small border-divider bg-background shadow-sm">
                <TableHeader>
                    <TableColumn>名称</TableColumn>
                    <TableColumn>状态</TableColumn>
                    <TableColumn>说明</TableColumn>
                    <TableColumn>更新时间</TableColumn>
                    <TableColumn align="center">操作</TableColumn>
                </TableHeader>
                <TableBody emptyContent="暂无配置">
                    {styles.map((style) => (
                        <TableRow key={style.id}>
                            <TableCell>
                                <span className="font-medium text-default-900">{style.name}</span>
                            </TableCell>
                            <TableCell>
                                {style.isDefault ? (
                                    <Chip
                                        color="success"
                                        size="sm"
                                        startContent={<Icon icon="solar:star-bold" />}
                                        variant="flat"
                                    >
                                        默认
                                    </Chip>
                                ) : (
                                    <Chip color="default" size="sm" variant="flat">
                                        普通
                                    </Chip>
                                )}
                            </TableCell>
                            <TableCell>
                                <span className="block max-w-xs truncate text-small text-default-500">
                                    {style.description || "-"}
                                </span>
                            </TableCell>
                            <TableCell>
                                <span className="text-small text-default-500">
                                    {new Date(style.updatedAt).toLocaleString("zh-CN")}
                                </span>
                            </TableCell>
                            <TableCell>
                                <div className="flex items-center justify-center gap-2">
                                    {!style.isDefault && (
                                        <Button
                                            color="success"
                                            size="sm"
                                            variant="light"
                                            onClick={() => handleSetDefault(style.id)}
                                        >
                                            设为默认
                                        </Button>
                                    )}
                                    <Button isIconOnly size="sm" variant="light" title="编辑" onClick={() => handleEdit(style)}>
                                        <Icon icon="solar:pen-linear" width={18} />
                                    </Button>
                                    <Button
                                        isIconOnly
                                        color="danger"
                                        isDisabled={style.isDefault}
                                        size="sm"
                                        title="删除"
                                        variant="light"
                                        onClick={() => handleDelete(style.id)}
                                    >
                                        <Icon icon="solar:trash-bin-trash-linear" width={18} />
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <StyleModal
                isOpen={isOpen}
                onClose={onClose}
                onSave={handleSave}
                promptPlaceholder={promptPlaceholder}
                style={editingStyle}
                type={type}
            />
        </div>
    );
}

function StyleModal({
    isOpen,
    onClose,
    style,
    onSave,
    promptPlaceholder,
    type,
}: {
    isOpen: boolean;
    onClose: () => void;
    style: Style | null;
    onSave: (data: StyleFormData) => Promise<void>;
    promptPlaceholder: string;
    type: StyleType;
}) {
    const [formData, setFormData] = useState<{
        name: string;
        description: string;
        promptTemplate: string;
        parameters: Record<string, unknown>;
    }>({
        name: "",
        description: "",
        promptTemplate: "",
        parameters: {},
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (style) {
            setFormData({
                name: style.name,
                description: style.description || "",
                promptTemplate: style.promptTemplate,
                parameters: style.parameters || {},
            });
            return;
        }

        setFormData({
            name: "",
            description: "",
            promptTemplate: "",
            parameters: {},
        });
    }, [style]);

    const handleSubmit = async () => {
        if (!formData.name.trim() || !formData.promptTemplate.trim()) {
            return;
        }

        setSaving(true);
        try {
            await onSave({
                ...formData,
                isDefault: style ? undefined : false,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="3xl">
            <ModalContent>
                <ModalHeader>{style ? "编辑配置" : "添加配置"}</ModalHeader>
                <ModalBody>
                    <div className="flex flex-col gap-4">
                        <Input
                            isRequired
                            label="名称"
                            labelPlacement="outside"
                            placeholder={
                                type === "article_system"
                                    ? "例如：公众号正文主提示词·V3"
                                    : "例如：公众号深度评论风格"
                            }
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                        <Input
                            label="说明"
                            labelPlacement="outside"
                            placeholder="简单说明这条配置控制的内容"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                        <Textarea
                            isRequired
                            label="Prompt 模板"
                            labelPlacement="outside"
                            minRows={10}
                            placeholder={promptPlaceholder}
                            value={formData.promptTemplate}
                            onChange={(e) => setFormData({ ...formData, promptTemplate: e.target.value })}
                        />
                        {type === "image" && (
                            <Input
                                label="图片比例（可选）"
                                labelPlacement="outside"
                                placeholder="例如：16:9"
                                value={typeof formData.parameters?.ratio === "string" ? formData.parameters.ratio : ""}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        parameters: { ...formData.parameters, ratio: e.target.value },
                                    })
                                }
                            />
                        )}
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onClick={onClose}>
                        取消
                    </Button>
                    <Button color="primary" isLoading={saving} onClick={handleSubmit}>
                        保存
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
