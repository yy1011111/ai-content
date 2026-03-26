"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    addToast,
    Button,
    Card,
    CardBody,
    Chip,
    Divider,
    Input,
    Modal,
    ModalBody,
    ModalContent,
    ModalFooter,
    ModalHeader,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableColumn,
    TableHeader,
    TableRow,
    Textarea,
    useDisclosure,
} from "@heroui/react";
import { Icon, loadIcons } from "@iconify/react";
import { stylesApi, Style } from "@/lib/api/styles";

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "未知错误";
}

type TemplateFormData = {
    name: string;
    description: string;
    promptTemplate: string;
    parameters: {
        placeholders: string;
        notes: string;
    };
};

const TEMPLATE_PLACEHOLDERS = [
    "{{title}}",
    "{{subtitle}}",
    "{{summary}}",
    "{{content}}",
    "{{cover_image}}",
    "[real-image-图片描述]",
    "[ai-image-图片描述]",
];

const DEFAULT_NOTES = "建议保留图片占位符，交给系统在生成后自动替换成真实图片地址。";

export default function TemplatesPage() {
    const { isOpen, onOpen, onClose } = useDisclosure();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [templates, setTemplates] = useState<Style[]>([]);
    const [editingTemplate, setEditingTemplate] = useState<Style | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [formData, setFormData] = useState<TemplateFormData>({
        name: "",
        description: "",
        promptTemplate: "",
        parameters: {
            placeholders: TEMPLATE_PLACEHOLDERS.join("\n"),
            notes: DEFAULT_NOTES,
        },
    });

    useEffect(() => {
        loadIcons([
            "solar:add-circle-bold",
            "solar:pen-linear",
            "solar:trash-bin-trash-linear",
            "solar:star-bold",
            "solar:upload-minimalistic-linear",
            "solar:code-square-linear",
            "solar:document-text-linear",
        ]);
    }, []);

    const fetchTemplates = useCallback(async () => {
        try {
            setLoading(true);
            const data = await stylesApi.list("template");
            setTemplates(data);
        } catch (error: unknown) {
            addToast({ title: "加载模板失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTemplates();
    }, [fetchTemplates]);

    const resetForm = useCallback(() => {
        setFormData({
            name: "",
            description: "",
            promptTemplate: "",
            parameters: {
                placeholders: TEMPLATE_PLACEHOLDERS.join("\n"),
                notes: DEFAULT_NOTES,
            },
        });
    }, []);

    const handleAdd = useCallback(() => {
        setEditingTemplate(null);
        resetForm();
        onOpen();
    }, [onOpen, resetForm]);

    const handleEdit = useCallback((template: Style) => {
        setEditingTemplate(template);
        setFormData({
            name: template.name,
            description: template.description || "",
            promptTemplate: template.promptTemplate,
            parameters: {
                placeholders: String(template.parameters?.placeholders || TEMPLATE_PLACEHOLDERS.join("\n")),
                notes: String(template.parameters?.notes || DEFAULT_NOTES),
            },
        });
        onOpen();
    }, [onOpen]);

    const handleDelete = useCallback(async (id: string) => {
        try {
            await stylesApi.remove(id);
            setTemplates((current) => current.filter((item) => item.id !== id));
            addToast({ title: "模板已删除", color: "success" });
        } catch (error: unknown) {
            addToast({ title: "删除失败", description: getErrorMessage(error), color: "danger" });
        }
    }, []);

    const handleSetDefault = useCallback(async (id: string) => {
        try {
            await stylesApi.setDefault(id);
            await fetchTemplates();
            addToast({ title: "已设为默认模板", color: "success" });
        } catch (error: unknown) {
            addToast({ title: "设置默认模板失败", description: getErrorMessage(error), color: "danger" });
        }
    }, [fetchTemplates]);

    const handleOpenFilePicker = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const html = typeof reader.result === "string" ? reader.result : "";
            setFormData((current) => ({
                ...current,
                name: current.name || file.name.replace(/\.html?$/i, ""),
                promptTemplate: html,
            }));
            addToast({ title: "模板内容已导入", color: "success" });
        };
        reader.onerror = () => {
            addToast({ title: "导入失败", description: "读取文件时发生错误", color: "danger" });
        };
        reader.readAsText(file, "utf-8");
        event.target.value = "";
    }, []);

    const handleSave = useCallback(async () => {
        if (!formData.name.trim() || !formData.promptTemplate.trim()) {
            addToast({ title: "请补全模板名称和 HTML 内容", color: "warning" });
            return;
        }

        setSaving(true);
        try {
            const payload = {
                name: formData.name.trim(),
                description: formData.description.trim(),
                promptTemplate: formData.promptTemplate,
                type: "template" as const,
                parameters: {
                    placeholders: formData.parameters.placeholders
                        .split("\n")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    notes: formData.parameters.notes.trim(),
                },
            };

            if (editingTemplate) {
                await stylesApi.update(editingTemplate.id, payload);
            } else {
                await stylesApi.create(payload);
            }

            addToast({ title: "模板保存成功", color: "success" });
            onClose();
            setEditingTemplate(null);
            resetForm();
            await fetchTemplates();
        } catch (error: unknown) {
            addToast({ title: "模板保存失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            setSaving(false);
        }
    }, [editingTemplate, fetchTemplates, formData, onClose, resetForm]);

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-10">
            <header className="rounded-medium border-small border-white/10 bg-background/60 p-5 shadow-sm backdrop-blur-md">
                <div className="flex flex-col">
                    <h2 className="text-xl font-bold text-default-900">文章模板</h2>
                    <span className="mt-1 text-small text-default-500">
                        管理公众号文章的 HTML 模板。这里决定段落节奏、标题样式、引用块和配图位置。
                    </span>
                </div>
            </header>

            <Card className="border-small border-white/10 bg-background/60 shadow-medium backdrop-blur-md">
                <CardBody className="p-6">
                    <div className="grid gap-6 xl:grid-cols-[1.6fr_0.9fr]">
                        <section className="flex flex-col gap-4">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <h3 className="text-medium font-bold text-default-900">HTML 模板管理</h3>
                                    <p className="mt-1 text-small text-default-500">
                                        支持 HTML 导入、在线编辑和默认模板切换。
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    <Button
                                        variant="flat"
                                        startContent={<Icon icon="solar:upload-minimalistic-linear" />}
                                        onClick={handleOpenFilePicker}
                                    >
                                        导入 HTML
                                    </Button>
                                    <Button color="primary" startContent={<Icon icon="solar:add-circle-bold" />} onClick={handleAdd}>
                                        新建模板
                                    </Button>
                                </div>
                            </div>

                            {loading ? (
                                <div className="flex justify-center py-16">
                                    <Spinner size="lg" />
                                </div>
                            ) : (
                                <Table aria-label="文章模板列表" className="rounded-medium border-small border-divider bg-background shadow-sm">
                                    <TableHeader>
                                        <TableColumn>模板名称</TableColumn>
                                        <TableColumn>状态</TableColumn>
                                        <TableColumn>说明</TableColumn>
                                        <TableColumn>更新时间</TableColumn>
                                        <TableColumn align="center">操作</TableColumn>
                                    </TableHeader>
                                    <TableBody emptyContent="暂无模板，请先导入或新建 HTML 模板。">
                                        {templates.map((template) => (
                                            <TableRow key={template.id}>
                                                <TableCell className="align-top">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="font-semibold text-default-900">{template.name}</span>
                                                        <span className="text-xs text-default-400">{template.promptTemplate.length} 个字符</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="align-top">
                                                    {template.isDefault ? (
                                                        <Chip color="success" variant="flat" startContent={<Icon icon="solar:star-bold" />}>
                                                            默认
                                                        </Chip>
                                                    ) : (
                                                        <Chip variant="flat">普通</Chip>
                                                    )}
                                                </TableCell>
                                                <TableCell className="align-top">
                                                    <span className="block max-w-md truncate text-sm text-default-500">
                                                        {template.description || "未填写模板说明"}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="align-top text-sm text-default-500">
                                                    {new Date(template.updatedAt).toLocaleString("zh-CN")}
                                                </TableCell>
                                                <TableCell className="align-top">
                                                    <div className="flex items-center justify-center gap-2">
                                                        {!template.isDefault && (
                                                            <Button
                                                                size="sm"
                                                                variant="light"
                                                                color="success"
                                                                onClick={() => handleSetDefault(template.id)}
                                                            >
                                                                设为默认
                                                            </Button>
                                                        )}
                                                        <Button isIconOnly size="sm" variant="light" onClick={() => handleEdit(template)}>
                                                            <Icon icon="solar:pen-linear" width={18} />
                                                        </Button>
                                                        <Button
                                                            isIconOnly
                                                            size="sm"
                                                            variant="light"
                                                            color="danger"
                                                            isDisabled={template.isDefault}
                                                            onClick={() => handleDelete(template.id)}
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
                        </section>

                        <section className="border-t border-divider/60 pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
                            <div className="pb-2">
                                <div className="flex items-center gap-2">
                                    <Icon className="text-primary" icon="solar:code-square-linear" width={20} />
                                    <h3 className="text-medium font-bold text-default-900">使用约定</h3>
                                </div>
                            </div>
                            <div className="space-y-4 text-sm leading-8 text-default-600">
                                <p>模板负责排版和结构，不负责把文章写好。好的模板应该让正文更顺眼，而不是把内容压成一整坨。</p>
                                <p>建议保留标题、小标题、引用块和图片位置这些骨架，让系统只替换内容本身。</p>
                                <p>图片节点建议保留占位符，后续由系统替换真实图片地址；如果图片不够贴切，宁可删掉对应模块。</p>
                            </div>
                            <Divider className="my-5" />
                            <div className="flex flex-wrap gap-2">
                                {TEMPLATE_PLACEHOLDERS.map((placeholder) => (
                                    <Chip key={placeholder} variant="flat" className="bg-default-100 text-default-700">
                                        {placeholder}
                                    </Chip>
                                ))}
                            </div>
                        </section>
                    </div>
                </CardBody>
            </Card>

            <input
                ref={fileInputRef}
                hidden
                accept=".html,text/html"
                type="file"
                onChange={handleFileSelected}
            />

            <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
                <ModalContent>
                    <ModalHeader className="border-b border-divider/60 pb-4">
                        {editingTemplate ? "编辑文章模板" : "新增文章模板"}
                    </ModalHeader>
                    <ModalBody>
                        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                            <div className="flex flex-col gap-4">
                                <Input
                                    label="模板名称"
                                    labelPlacement="outside"
                                    placeholder="例如：极简深度评论版"
                                    value={formData.name}
                                    onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                                />
                                <Input
                                    label="模板说明"
                                    labelPlacement="outside"
                                    placeholder="说明适合什么文章、版式重点是什么"
                                    value={formData.description}
                                    onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                                />
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-semibold text-default-700">模板 HTML</p>
                                        <p className="text-xs text-default-400">可以直接粘贴 HTML，也可以从本地导入 `.html` 文件。</p>
                                    </div>
                                    <Button
                                        variant="flat"
                                        startContent={<Icon icon="solar:upload-minimalistic-linear" />}
                                        onClick={handleOpenFilePicker}
                                    >
                                        导入 HTML
                                    </Button>
                                </div>
                                <Textarea
                                    minRows={18}
                                    labelPlacement="outside"
                                    placeholder="请粘贴完整的 HTML 模板内容"
                                    value={formData.promptTemplate}
                                    onChange={(event) => setFormData((current) => ({ ...current, promptTemplate: event.target.value }))}
                                />
                            </div>

                            <div className="flex flex-col gap-4">
                                <Textarea
                                    minRows={8}
                                    label="推荐占位符"
                                    labelPlacement="outside"
                                    description="每行一个，用于提示后续生成和渲染流程有哪些槽位可替换。"
                                    value={formData.parameters.placeholders}
                                    onChange={(event) =>
                                        setFormData((current) => ({
                                            ...current,
                                            parameters: { ...current.parameters, placeholders: event.target.value },
                                        }))
                                    }
                                />
                                <Textarea
                                    minRows={8}
                                    label="模板备注"
                                    labelPlacement="outside"
                                    description="记录这个模板的使用场景、图片规则或特殊结构说明。"
                                    placeholder="例如：适合热点评论，要求必须有导语卡片和一个引用块。"
                                    value={formData.parameters.notes}
                                    onChange={(event) =>
                                        setFormData((current) => ({
                                            ...current,
                                            parameters: { ...current.parameters, notes: event.target.value },
                                        }))
                                    }
                                />

                                <Card className="border-small border-divider/70 bg-default-50/70 shadow-none">
                                    <CardBody className="gap-3 text-sm leading-7 text-default-600">
                                        <div className="flex items-center gap-2 font-semibold text-default-800">
                                            <Icon icon="solar:document-text-linear" width={18} />
                                            录入建议
                                        </div>
                                        <p>保留模板里的结构块，避免让 AI 每次重新拼版式。</p>
                                        <p>如果某个模块必须存在，就保留该 HTML 结构，只把文案替换成更清晰的占位符。</p>
                                        <p>图片节点保留 <code>&lt;img src="..." /&gt;</code> 即可，后续由系统替换真实地址。</p>
                                    </CardBody>
                                </Card>
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter className="border-t border-divider/60 pt-4">
                        <Button variant="flat" onClick={onClose}>取消</Button>
                        <Button color="primary" onClick={handleSave} isLoading={saving}>保存模板</Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    );
}
