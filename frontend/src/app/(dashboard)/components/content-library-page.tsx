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
    Textarea,
    Button,
    Chip,
    Pagination,
    Tooltip,
    Selection,
    SortDescriptor,
    Spinner,
    addToast,
    User,
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    useDisclosure,
    Select,
    SelectItem,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { articlesApi, Article, ArticleQuery } from "@/lib/api/articles";
import { publishingApi, PublishAccount } from "@/lib/api/publishing";

const columns = [
    { name: "标题 / 摘要", uid: "title" },
    { name: "所属选题", uid: "topic" },
    { name: "状态", uid: "status" },
    { name: "生成时间", uid: "createdAt" },
    { name: "操作", uid: "actions" },
];

const statusMap: Record<string, { label: string; color: "default" | "primary" | "secondary" | "success" | "warning" | "danger" }> = {
    draft: { label: "草稿", color: "warning" },
    published: { label: "已发布", color: "success" },
};

function isHtmlArticle(article: Article | null): boolean {
    if (!article) return false;
    return article.contentFormat === "html" || Boolean(article.finalHtml);
}

function getPreviewContent(article: Article): string {
    if (isHtmlArticle(article)) {
        return article.finalHtml || article.content || "";
    }

    return article.content?.replace(/\\n/g, "\n").replace(/\\"/g, '"') || "";
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "未知错误";
}

function sanitizeFilename(value: string): string {
    return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "xiaohongshu-note";
}

function getXiaohongshuSlideTitle(slide: NonNullable<Article["xiaohongshuData"]>["slides"][number]): string {
    return slide.title || slide.coverText || "未命名卡片";
}

function getXiaohongshuSlideBody(slide: NonNullable<Article["xiaohongshuData"]>["slides"][number]): string {
    return slide.body || slide.bodyText || "";
}

function getXiaohongshuSlideBullets(slide: NonNullable<Article["xiaohongshuData"]>["slides"][number]): string[] {
    return Array.isArray(slide.bullets) ? slide.bullets.filter(Boolean) : [];
}

function getXiaohongshuRenderedCardUrl(slide: NonNullable<Article["xiaohongshuData"]>["slides"][number]): string | null {
    return slide.cardImageUrl || slide.imageUrl || null;
}

function getDownloadExtension(url: string): string {
    if (url.startsWith("data:image/png")) {
        return "png";
    }
    if (url.startsWith("data:image/svg+xml")) {
        return "svg";
    }

    const matched = url.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
    return matched?.[1]?.toLowerCase() || "png";
}

function extractHtmlClipboardPayload(content: string): { html: string; text: string } {
    if (typeof window === "undefined") {
        return { html: content, text: content };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "text/html");
    const html = doc.body?.innerHTML?.trim() || content;
    const text = doc.body?.textContent?.trim() || content;
    return { html, text };
}

function buildHtmlPreviewDocument(content: string): string {
    const trimmedContent = content.trim();
    const hasFullDocument = /<html[\s>]/i.test(trimmedContent) || /<!doctype/i.test(trimmedContent);

    if (hasFullDocument) {
        return trimmedContent;
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #f5f7fb;
      }

      body {
        box-sizing: border-box;
        padding: 24px;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      img {
        max-width: 100%;
        height: auto;
      }
    </style>
  </head>
  <body>
    ${trimmedContent}
  </body>
</html>`;
}

type HtmlEditMode = "visual" | "source";

type HtmlEditorSnapshot = {
    isFullDocument: boolean;
    hasDoctype: boolean;
};

const HTML_EDITOR_STYLE_TAG = `<style id="codex-html-editor-style">
  html, body {
    min-height: 100%;
  }

  body[data-codex-editable-root="true"] {
    outline: none;
    caret-color: #0f172a;
  }

  body[data-codex-editable-root="true"]:focus {
    box-shadow: inset 0 0 0 2px rgba(14, 116, 144, 0.22);
  }

  body[data-codex-editable-root="true"] ::selection {
    background: rgba(14, 116, 144, 0.18);
  }
</style>`;

function detectFullHtmlDocument(content: string): boolean {
    const trimmedContent = content.trim();
    return /<html[\s>]/i.test(trimmedContent) || /<!doctype/i.test(trimmedContent);
}

function buildEditableHtmlDocument(content: string): string {
    const trimmedContent = content.trim();
    const isFullDocument = detectFullHtmlDocument(trimmedContent);

    if (!trimmedContent) {
        return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${HTML_EDITOR_STYLE_TAG}
  </head>
  <body></body>
</html>`;
    }

    if (!isFullDocument) {
        return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${HTML_EDITOR_STYLE_TAG}
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #f5f7fb;
      }

      body {
        box-sizing: border-box;
        padding: 24px;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      img {
        max-width: 100%;
        height: auto;
      }
    </style>
  </head>
  <body>
    ${trimmedContent}
  </body>
</html>`;
    }

    if (/<head[\s>]/i.test(trimmedContent)) {
        return trimmedContent.replace(/<\/head>/i, `${HTML_EDITOR_STYLE_TAG}</head>`);
    }

    if (/<body[\s>]/i.test(trimmedContent)) {
        return trimmedContent.replace(/<body([^>]*)>/i, `<head>${HTML_EDITOR_STYLE_TAG}</head><body$1>`);
    }

    return buildEditableHtmlDocument(trimmedContent.replace(/<html([^>]*)>/i, `<html$1><head>${HTML_EDITOR_STYLE_TAG}</head>`));
}

function stripHtmlEditorArtifacts(content: string): string {
    return content
        .replace(/<style id="codex-html-editor-style">[\s\S]*?<\/style>/gi, "")
        .replace(/\sdata-codex-editable-root="true"/gi, "")
        .replace(/\scontenteditable="true"/gi, "")
        .replace(/\sspellcheck="false"/gi, "");
}

function serializeEditableHtmlDocument(document: Document, snapshot: HtmlEditorSnapshot): string {
    if (!snapshot.isFullDocument) {
        return document.body?.innerHTML || "";
    }

    const serializedHtml = stripHtmlEditorArtifacts(document.documentElement.outerHTML);
    return snapshot.hasDoctype ? `<!DOCTYPE html>\n${serializedHtml}` : serializedHtml;
}

const markdownComponents: Components = {
    img: ({ alt, ...props }) => (
        <span className="block my-6 rounded-large overflow-hidden border border-divider shadow-sm bg-default-100/50">
            {/* 列表预览保持接近发布效果 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img {...props} className="w-full h-auto object-cover max-h-[500px]" alt={alt || "内容插图"} />
            {alt && (
                <span className="block text-center text-tiny text-default-500 py-2 bg-default-50/50 border-t border-divider">
                    {alt}
                </span>
            )}
        </span>
    ),
    h1: (props) => <h1 className="text-2xl font-bold mt-8 mb-4 border-b border-divider pb-2" {...props} />,
    h2: (props) => <h2 className="text-xl font-semibold mt-6 mb-3" {...props} />,
    h3: (props) => <h3 className="text-lg font-medium mt-5 mb-2" {...props} />,
    p: (props) => <p className="text-default-700 leading-relaxed mb-4 text-medium" {...props} />,
    blockquote: (props) => (
        <blockquote className="border-l-4 border-primary bg-primary-50/30 text-default-600 p-4 my-4 rounded-r-medium text-small italic" {...props} />
    ),
    ul: (props) => <ul className="list-disc list-inside space-y-2 mb-4 text-default-700 ml-4" {...props} />,
    ol: (props) => <ol className="list-decimal list-inside space-y-2 mb-4 text-default-700 ml-4" {...props} />,
    li: (props) => <li className="mb-1" {...props} />,
    code: ({ className, children, ...props }) => {
        const isInline = !className;
        return isInline ? (
            <code className="bg-default-100 text-default-800 px-1.5 py-0.5 rounded-md text-small font-mono mx-1" {...props}>
                {children}
            </code>
        ) : (
            <div className="my-4 rounded-large overflow-hidden border border-divider">
                <pre className="bg-[#1e1e1e] p-4 overflow-x-auto text-sm">
                    <code className="text-gray-300 font-mono" {...props}>
                        {children}
                    </code>
                </pre>
            </div>
        );
    },
};

type ContentLibraryPageProps = {
    contentType: "article" | "xiaohongshu";
    title: string;
    description: string;
    searchPlaceholder: string;
    totalLabel: string;
    emptyLabel: string;
    deleteLabel: string;
    publishLabel: string;
    previewTitle: string;
    publishModalSubject: string;
    allowPublish?: boolean;
    allowEdit?: boolean;
};

export function ContentLibraryPage({
    contentType,
    title,
    description,
    searchPlaceholder,
    totalLabel,
    emptyLabel,
    deleteLabel,
    publishLabel,
    previewTitle,
    publishModalSubject,
    allowPublish = true,
    allowEdit = true,
}: ContentLibraryPageProps) {
    const isXiaohongshu = contentType === "xiaohongshu";
    const [filterValue, setFilterValue] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set([]));
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
        column: "createdAt",
        direction: "descending",
    });

    const [items, setItems] = useState<Article[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    const { isOpen, onOpen, onOpenChange } = useDisclosure();
    const [previewArticle, setPreviewArticle] = useState<Article | null>(null);

    const [isEditMode, setIsEditMode] = useState(false);
    const [editData, setEditData] = useState<{ title: string; content: string }>({ title: "", content: "" });
    const [isSaving, setIsSaving] = useState(false);
    const [isMounted, setIsMounted] = useState(false);
    const [htmlEditMode, setHtmlEditMode] = useState<HtmlEditMode>("visual");
    const [htmlEditorDocument, setHtmlEditorDocument] = useState("");
    const [htmlEditorFrameKey, setHtmlEditorFrameKey] = useState(0);

    const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onOpenChange: onDeleteOpenChange, onClose: onDeleteClose } = useDisclosure();
    const [articleToDelete, setArticleToDelete] = useState<{ id: string; title: string } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const { isOpen: isPublishOpen, onOpen: onPublishOpen, onOpenChange: onPublishOpenChange, onClose: onPublishClose } = useDisclosure();
    const [articleToPublish, setArticleToPublish] = useState<Article | null>(null);
    const [publishAccounts, setPublishAccounts] = useState<PublishAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>("");
    const [isPublishing, setIsPublishing] = useState(false);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const htmlEditorFrameRef = useRef<HTMLIFrameElement | null>(null);
    const htmlEditorSnapshotRef = useRef<HtmlEditorSnapshot>({ isFullDocument: false, hasDoctype: false });
    const htmlEditorCleanupRef = useRef<(() => void) | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const queryData: ArticleQuery = {
                page,
                limit: rowsPerPage,
                contentType,
            };
            if (filterValue) {
                queryData.keyword = filterValue;
            }
            if (statusFilter && statusFilter !== "all") {
                queryData.status = statusFilter;
            }

            const result = await articlesApi.list(queryData);
            setItems(result.items);
            setTotal(result.total);
            setTotalPages(result.totalPages);
        } catch (error: unknown) {
            addToast({ title: `加载${title}失败`, description: getErrorMessage(error), color: "danger" });
        } finally {
            setIsLoading(false);
        }
    }, [contentType, filterValue, page, rowsPerPage, statusFilter, title]);

    useEffect(() => {
        setIsMounted(true);
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        return () => {
            htmlEditorCleanupRef.current?.();
        };
    }, []);

    const onSearchChange = useCallback((value?: string) => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
            setFilterValue(value || "");
            setPage(1);
        }, 300);
    }, []);

    const confirmDelete = useCallback(async () => {
        if (!articleToDelete) return;
        setIsDeleting(true);
        try {
            await articlesApi.remove(articleToDelete.id);
            addToast({ title: "删除成功", color: "success" });
            fetchData();
            onDeleteClose();
        } catch (error: unknown) {
            addToast({ title: "删除失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            setIsDeleting(false);
            setArticleToDelete(null);
        }
    }, [articleToDelete, fetchData, onDeleteClose]);

    const handleDeleteClick = useCallback((id: string, titleText: string) => {
        setArticleToDelete({ id, title: titleText });
        onDeleteOpen();
    }, [onDeleteOpen]);

    const readHtmlEditorContent = useCallback(() => {
        const editorDocument = htmlEditorFrameRef.current?.contentDocument;
        if (!editorDocument) {
            return null;
        }

        return serializeEditableHtmlDocument(editorDocument, htmlEditorSnapshotRef.current);
    }, []);

    const syncHtmlEditorContent = useCallback(() => {
        const nextContent = readHtmlEditorContent();
        if (nextContent === null) {
            return null;
        }

        setEditData((current) => current.content === nextContent ? current : { ...current, content: nextContent });
        return nextContent;
    }, [readHtmlEditorContent]);

    const prepareHtmlVisualEditor = useCallback((content: string) => {
        htmlEditorSnapshotRef.current = {
            isFullDocument: detectFullHtmlDocument(content),
            hasDoctype: /<!doctype/i.test(content),
        };
        setHtmlEditorDocument(buildEditableHtmlDocument(content));
        setHtmlEditorFrameKey((current) => current + 1);
    }, []);

    const handleHtmlEditorLoad = useCallback(() => {
        htmlEditorCleanupRef.current?.();

        const editorDocument = htmlEditorFrameRef.current?.contentDocument;
        if (!editorDocument?.body) {
            return;
        }

        editorDocument.body.setAttribute("data-codex-editable-root", "true");
        editorDocument.body.setAttribute("contenteditable", "true");
        editorDocument.body.setAttribute("spellcheck", "false");

        const handleEditorInput = () => {
            syncHtmlEditorContent();
        };

        editorDocument.body.addEventListener("input", handleEditorInput);
        editorDocument.body.addEventListener("blur", handleEditorInput, true);
        editorDocument.body.addEventListener("paste", handleEditorInput);
        editorDocument.body.addEventListener("keyup", handleEditorInput);

        htmlEditorCleanupRef.current = () => {
            editorDocument.body.removeEventListener("input", handleEditorInput);
            editorDocument.body.removeEventListener("blur", handleEditorInput, true);
            editorDocument.body.removeEventListener("paste", handleEditorInput);
            editorDocument.body.removeEventListener("keyup", handleEditorInput);
        };
    }, [syncHtmlEditorContent]);

    const handleStartEdit = useCallback(() => {
        if (!previewArticle) return;

        if (isHtmlArticle(previewArticle)) {
            setHtmlEditMode("visual");
            prepareHtmlVisualEditor(editData.content);
        } else {
            setHtmlEditMode("source");
        }

        setIsEditMode(true);
    }, [editData.content, prepareHtmlVisualEditor, previewArticle]);

    const handleSaveEdit = async () => {
        if (!previewArticle) return;
        setIsSaving(true);
        try {
            const nextContent = isHtmlArticle(previewArticle) && htmlEditMode === "visual"
                ? (syncHtmlEditorContent() ?? editData.content)
                : editData.content;
            const nextEditData = { ...editData, content: nextContent };
            const payload = isHtmlArticle(previewArticle)
                ? { ...nextEditData, finalHtml: nextContent, contentFormat: "html" as const }
                : nextEditData;

            await articlesApi.update(previewArticle.id, payload);
            addToast({ title: "修改保存成功", color: "success" });
            setEditData(nextEditData);
            const updatedArticle = isHtmlArticle(previewArticle)
                ? { ...previewArticle, ...nextEditData, finalHtml: nextContent, contentFormat: "html" as const }
                : { ...previewArticle, ...nextEditData };
            setPreviewArticle(updatedArticle as Article);
            setIsEditMode(false);
            fetchData();
        } catch (error: unknown) {
            addToast({ title: "修改失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            setIsSaving(false);
        }
    };

    const handlePublishClick = useCallback(async (article: Article) => {
        if (!allowPublish) return;
        setArticleToPublish(article);
        try {
            const accounts = await publishingApi.getAccounts();
            const matchedAccounts = accounts.filter((account) =>
                isXiaohongshu ? account.platform === "xiaohongshu" : account.platform === "wechat",
            );

            setPublishAccounts(matchedAccounts);
            setSelectedAccountId(matchedAccounts.length > 0 ? matchedAccounts[0].id : "");
        } catch {
            setPublishAccounts([]);
            setSelectedAccountId("");
        }
        onPublishOpen();
    }, [allowPublish, isXiaohongshu, onPublishOpen]);

    const confirmPublish = async () => {
        if (!articleToPublish || (!selectedAccountId && publishAccounts.length > 0)) {
            addToast({ title: "请选择发布账号", color: "warning" });
            return;
        }
        setIsPublishing(true);
        try {
            const result = await publishingApi.publishArticle(articleToPublish.id, selectedAccountId);
            addToast({
                title: result.deliveryStatus === "published" ? `${publishLabel}成功` : `${publishLabel}已提交`,
                description: result.message,
                color: "success",
            });
            fetchData();
            onPublishClose();
        } catch (error: unknown) {
            addToast({ title: "发布失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            setIsPublishing(false);
        }
    };

    const triggerDownload = useCallback((blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }, []);

    const handleDownloadXiaohongshu = useCallback(async (article: Article) => {
        if (!article.xiaohongshuData) {
            addToast({ title: "当前笔记缺少下载数据", color: "warning" });
            return;
        }

        const safeBaseName = sanitizeFilename(article.title);
        const noteText = [
            article.xiaohongshuData.title,
            "",
            article.xiaohongshuData.caption,
            "",
            article.xiaohongshuData.hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" "),
            "",
            ...article.xiaohongshuData.slides.map((slide, index) => `第 ${index + 1} 张
页面角色：${slide.role || "未标注"}
模板：${slide.template || "旧版卡片"}
主标题：${getXiaohongshuSlideTitle(slide)}
主体文案：${getXiaohongshuSlideBody(slide)}
高亮文案：${slide.highlight || "无"}
要点：${getXiaohongshuSlideBullets(slide).join(" | ") || "无"}
出图方式：${slide.imageType}
提示词：${slide.imagePrompt || "无"}
背景图地址：${slide.backgroundImageUrl || slide.imageUrl || "无"}
成品卡图地址：${slide.cardImageUrl || "无"}`),
        ].join("\n");

        triggerDownload(new Blob([noteText], { type: "text/plain;charset=utf-8" }), `${safeBaseName}.txt`);

        let successCount = 0;
        for (let index = 0; index < article.xiaohongshuData.slides.length; index++) {
            const slide = article.xiaohongshuData.slides[index];
            const downloadUrl = getXiaohongshuRenderedCardUrl(slide);
            if (!downloadUrl) {
                continue;
            }

            const fileName = `${safeBaseName}-${String(index + 1).padStart(2, "0")}.${getDownloadExtension(downloadUrl)}`;
            try {
                const response = await fetch(downloadUrl);
                const blob = await response.blob();
                triggerDownload(blob, fileName);
                successCount++;
            } catch {
                const link = document.createElement("a");
                link.href = downloadUrl;
                link.target = "_blank";
                link.rel = "noreferrer";
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                link.remove();
            }
        }

        addToast({
            title: "开始下载小红书素材",
            description: `已导出文案文件，并尝试下载 ${successCount} 张成品卡图`,
            color: "success",
        });
    }, [triggerDownload]);

    const handleCopyArticle = useCallback(async (article: Article) => {
        try {
            if (isHtmlArticle(article)) {
                const sourceHtml = article.finalHtml || article.content || "";
                const { html, text } = extractHtmlClipboardPayload(sourceHtml);

                if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
                    await navigator.clipboard.write([
                        new ClipboardItem({
                            "text/html": new Blob([html], { type: "text/html" }),
                            "text/plain": new Blob([text], { type: "text/plain" }),
                        }),
                    ]);
                } else {
                    await navigator.clipboard.writeText(text);
                }

                addToast({ title: "文章已复制", description: "可直接粘贴到公众号编辑器中", color: "success" });
                return;
            }

            await navigator.clipboard.writeText(article.content || "");
            addToast({ title: "文章正文已复制", description: "当前为纯文本内容", color: "success" });
        } catch (error: unknown) {
            addToast({ title: "复制失败", description: getErrorMessage(error), color: "danger" });
        }
    }, []);

    const renderCell = useCallback((item: Article, columnKey: React.Key) => {
        const cellValue = item[columnKey as keyof Article];

        switch (columnKey) {
            case "title":
                return (
                    <User
                        avatarProps={{ radius: "sm", src: item.coverImage || undefined, icon: <Icon icon="solar:gallery-bold-duotone" width={20} /> }}
                        description={item.topic?.title || "独立撰写"}
                        name={
                            <span className="text-small text-default-900 truncate font-bold max-w-[280px] block" title={item.title}>
                                {item.title}
                            </span>
                        }
                    />
                );
            case "topic":
                return item.topic?.keywords ? (
                    <div className="flex gap-1 flex-wrap">
                        {item.topic.keywords.slice(0, 3).map((kw, idx) => (
                            <Chip key={idx} size="sm" variant="flat" className="text-tiny h-5 bg-default-100">
                                {kw}
                            </Chip>
                        ))}
                    </div>
                ) : <span className="text-tiny text-default-400">无标签</span>;
            case "status":
                const statusConfig = statusMap[item.status] || { label: "未知", color: "default" as const };
                return (
                    <Chip size="sm" variant="flat" color={statusConfig.color}>
                        {statusConfig.label}
                    </Chip>
                );
            case "createdAt":
                return (
                    <span className="text-small text-default-500">
                        {new Date(cellValue as string).toLocaleString("zh-CN", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                        })}
                    </span>
                );
            case "actions":
                return (
                    <div className="flex items-center gap-2">
                        <Tooltip content="预览排版">
                            <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                color="primary"
                                onClick={() => {
                                    const cleanedContent = getPreviewContent(item);
                                    setPreviewArticle({ ...item, content: cleanedContent });
                                    setEditData({ title: item.title, content: cleanedContent });
                                    setIsEditMode(false);
                                    setHtmlEditMode("visual");
                                    onOpen();
                                }}
                            >
                                <Icon icon="solar:eye-bold" width={18} />
                            </Button>
                        </Tooltip>
                        {allowPublish && (
                            <Tooltip content={publishLabel} color="success">
                                <Button isIconOnly size="sm" variant="light" onClick={() => handlePublishClick(item)}>
                                    <Icon icon="solar:round-transfer-diagonal-linear" width={18} />
                                </Button>
                            </Tooltip>
                        )}
                        {!isXiaohongshu && (
                            <Tooltip content="一键复制">
                                <Button isIconOnly size="sm" variant="light" color="secondary" onClick={() => void handleCopyArticle(item)}>
                                    <Icon icon="solar:copy-linear" width={18} />
                                </Button>
                            </Tooltip>
                        )}
                        {isXiaohongshu && (
                            <Tooltip content="一键下载">
                                <Button isIconOnly size="sm" variant="light" color="secondary" onClick={() => void handleDownloadXiaohongshu(item)}>
                                    <Icon icon="solar:download-minimalistic-linear" width={18} />
                                </Button>
                            </Tooltip>
                        )}
                        <Tooltip content={deleteLabel} color="danger">
                            <Button isIconOnly size="sm" variant="light" color="danger" onClick={() => handleDeleteClick(item.id, item.title)}>
                                <Icon icon="solar:trash-bin-trash-linear" width={18} />
                            </Button>
                        </Tooltip>
                    </div>
                );
            default:
                return null;
        }
    }, [allowPublish, deleteLabel, handleCopyArticle, handleDeleteClick, handleDownloadXiaohongshu, handlePublishClick, isXiaohongshu, onOpen, publishLabel]);

    const topContent = (
        <div className="flex flex-col gap-4 mb-2">
            <div className="flex justify-between gap-3 items-end">
                <div className="flex items-center gap-3 w-full flex-wrap">
                    <Input
                        isClearable
                        classNames={{
                            base: "w-full sm:max-w-[280px]",
                            mainWrapper: "h-full",
                            input: "text-small",
                            inputWrapper: "h-full font-normal text-default-500 bg-default-400/20 dark:bg-default-500/20 backdrop-blur-md",
                        }}
                        size="sm"
                        placeholder={searchPlaceholder}
                        startContent={<Icon icon="solar:magnifer-linear" className="text-default-300" />}
                        defaultValue={filterValue}
                        onClear={() => {
                            setFilterValue("");
                            setPage(1);
                        }}
                        onValueChange={onSearchChange}
                    />
                    <Select
                        size="sm"
                        placeholder="所有状态"
                        selectedKeys={[statusFilter]}
                        onSelectionChange={(keys) => {
                            setStatusFilter(Array.from(keys)[0] as string);
                            setPage(1);
                        }}
                        classNames={{
                            base: "w-full sm:max-w-[150px]",
                            trigger: "h-full bg-default-400/20 dark:bg-default-500/20 backdrop-blur-md",
                        }}
                    >
                        <SelectItem key="all">所有状态</SelectItem>
                        <SelectItem key="draft">草稿</SelectItem>
                        <SelectItem key="published">已发布</SelectItem>
                    </Select>
                </div>
            </div>
            <div className="flex justify-between items-center">
                <span className="text-default-400 text-small">{totalLabel.replace("{count}", String(total))}</span>
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

    const isEditingHtmlArticle = isEditMode && Boolean(previewArticle && isHtmlArticle(previewArticle));

    return (
        <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10">
            <header className="rounded-medium border-small border-white/10 flex items-center justify-between gap-3 p-5 bg-background/60 backdrop-blur-md shadow-sm">
                <div className="flex flex-col">
                    <h2 className="text-xl text-default-900 font-bold">{title}</h2>
                    <span className="text-small text-default-500 mt-1">{description}</span>
                </div>
            </header>

            {isMounted ? (
                <Table
                    aria-label={`${title}列表`}
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
                    onSelectionChange={setSelectedKeys}
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
                                allowsSorting={column.uid !== "actions" && column.uid !== "topic"}
                            >
                                {column.name}
                            </TableColumn>
                        )}
                    </TableHeader>
                    <TableBody
                        emptyContent={isLoading ? " " : emptyLabel}
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

            <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="3xl" scrollBehavior="inside" backdrop="blur">
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader className="flex flex-col gap-1 border-b border-divider bg-default-50/50">
                                {isEditMode ? (
                                    <Input
                                        size="lg"
                                        variant="underlined"
                                        value={editData.title}
                                        onValueChange={(val) => setEditData({ ...editData, title: val })}
                                        className="font-bold text-xl mb-1"
                                        classNames={{ input: "font-bold text-xl" }}
                                    />
                                ) : (
                                    <h3 className="text-xl font-bold">{previewArticle?.title}</h3>
                                )}
                                {previewArticle?.topic && (
                                    <span className="text-small text-default-500 font-normal mt-1">
                                        基于选题: {previewArticle.topic.title}
                                    </span>
                                )}
                                {previewArticle?.template && (
                                    <span className="text-small text-secondary-600 font-medium mt-1">
                                        模板: {previewArticle.template.name}
                                    </span>
                                )}
                            </ModalHeader>
                            <ModalBody className="content-markdown overflow-y-auto py-6">
                                {isEditMode ? (
                                    <div className="flex flex-col gap-4">
                                        {isEditingHtmlArticle && (
                                            <div className="flex flex-col gap-3 rounded-large border border-divider bg-default-50/80 p-3">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        color={htmlEditMode === "visual" ? "primary" : "default"}
                                                        variant={htmlEditMode === "visual" ? "solid" : "flat"}
                                                        onClick={() => {
                                                            setHtmlEditMode("visual");
                                                            prepareHtmlVisualEditor(editData.content);
                                                        }}
                                                    >
                                                        可视化编辑
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        color={htmlEditMode === "source" ? "secondary" : "default"}
                                                        variant={htmlEditMode === "source" ? "solid" : "flat"}
                                                        onClick={() => {
                                                            syncHtmlEditorContent();
                                                            setHtmlEditMode("source");
                                                        }}
                                                    >
                                                        源码模式
                                                    </Button>
                                                </div>
                                                <p className="text-tiny leading-6 text-default-500">
                                                    可视化模式会直接渲染模板效果，您可以在页面里直接修改文字；只有需要精确调整 HTML 结构时，再切换到源码模式。
                                                </p>
                                            </div>
                                        )}
                                        {isEditingHtmlArticle && htmlEditMode === "visual" ? (
                                            <iframe
                                                key={htmlEditorFrameKey}
                                                ref={htmlEditorFrameRef}
                                                title={`${previewTitle}-editable`}
                                                className="h-[70vh] w-full rounded-large border border-divider bg-white shadow-sm"
                                                srcDoc={htmlEditorDocument}
                                                onLoad={handleHtmlEditorLoad}
                                            />
                                        ) : (
                                            <Textarea
                                                variant="flat"
                                                value={editData.content}
                                                onValueChange={(val) => setEditData({ ...editData, content: val })}
                                                minRows={25}
                                                maxRows={35}
                                                classNames={{
                                                    base: "h-full w-full",
                                                    input: "text-medium font-mono leading-relaxed h-full !bg-transparent",
                                                    inputWrapper: "h-full border-0 !bg-transparent shadow-none px-0",
                                                }}
                                            />
                                        )}
                                    </div>
                                ) : previewArticle?.content ? (
                                    isXiaohongshu && previewArticle?.xiaohongshuData ? (
                                        <div className="flex flex-col gap-6">
                                            <div className="rounded-[28px] border border-[#eadfd8] bg-[#fffaf7] p-5 shadow-sm">
                                                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
                                                    {previewArticle.xiaohongshuData.caption}
                                                </p>
                                                {previewArticle.xiaohongshuData.hashtags.length > 0 && (
                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                        {previewArticle.xiaohongshuData.hashtags.map((tag) => (
                                                            <Chip key={tag} size="sm" variant="flat" className="border border-[#f4bfd0] bg-[#ffe5ee] text-[#d6336c]">
                                                                {tag.startsWith("#") ? tag : `#${tag}`}
                                                            </Chip>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                {previewArticle.xiaohongshuData.slides.map((slide, index) => (
                                                    <article key={`${slide.coverText}-${index}`} className="overflow-hidden rounded-[28px] border border-divider bg-white shadow-sm">
                                                        <div className="relative aspect-[3/4] bg-default-100">
                                                            {getXiaohongshuRenderedCardUrl(slide) ? (
                                                                // eslint-disable-next-line @next/next/no-img-element
                                                                <img src={getXiaohongshuRenderedCardUrl(slide) || undefined} alt={getXiaohongshuSlideTitle(slide)} className="h-full w-full object-cover" />
                                                            ) : (
                                                                <div className="flex h-full items-center justify-center text-default-400">
                                                                    <Icon icon="solar:gallery-remove-broken" width={36} />
                                                                </div>
                                                            )}
                                                            <div className="absolute inset-x-0 top-0 flex items-start justify-between p-5">
                                                                <div className="inline-flex rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white/90">
                                                                    第 {index + 1} 张
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="border-t border-divider px-4 py-3">
                                                            <div className="flex flex-col gap-3">
                                                                <div className="flex flex-wrap items-center gap-2 text-xs text-default-500">
                                                                    {slide.role && (
                                                                        <Chip size="sm" variant="flat" color="warning">
                                                                            {slide.role}
                                                                        </Chip>
                                                                    )}
                                                                    <Chip size="sm" variant="flat" color={slide.imageType === "real" ? "success" : slide.imageType === "none" ? "default" : "secondary"}>
                                                                        {slide.imageType === "real" ? "真实图辅助" : slide.imageType === "none" ? "纯文字卡" : "AI 图辅助"}
                                                                    </Chip>
                                                                </div>
                                                                <div>
                                                                    <h4 className="text-base font-bold text-default-900">{getXiaohongshuSlideTitle(slide)}</h4>
                                                                    {getXiaohongshuSlideBody(slide) && (
                                                                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-default-600">{getXiaohongshuSlideBody(slide)}</p>
                                                                    )}
                                                                </div>
                                                                {slide.highlight && (
                                                                    <div className="rounded-2xl bg-secondary-50 px-3 py-2 text-sm font-semibold text-secondary-700">
                                                                        {slide.highlight}
                                                                    </div>
                                                                )}
                                                                {getXiaohongshuSlideBullets(slide).length > 0 && (
                                                                    <div className="flex flex-col gap-2 text-sm text-default-600">
                                                                        {getXiaohongshuSlideBullets(slide).map((bullet) => (
                                                                            <div key={bullet} className="flex items-start gap-2">
                                                                                <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                                                                                <span>{bullet}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                {slide.imagePrompt && (
                                                                    <p className="text-xs leading-5 text-default-400">背景提示词：{slide.imagePrompt}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </article>
                                                ))}
                                            </div>
                                        </div>
                                    ) : isHtmlArticle(previewArticle) ? (
                                        <iframe
                                            title={previewTitle}
                                            className="h-[70vh] w-full rounded-large border border-divider bg-white shadow-sm"
                                            srcDoc={buildHtmlPreviewDocument(previewArticle.content)}
                                        />
                                    ) : (
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                            {previewArticle.content}
                                        </ReactMarkdown>
                                    )
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-20 text-default-400 gap-4">
                                        <Icon icon="solar:document-text-broken" width={48} />
                                        <p>无正文内容</p>
                                    </div>
                                )}
                            </ModalBody>
                            <ModalFooter className="border-t border-divider">
                                {!isEditMode ? (
                                    <>
                                        {isXiaohongshu && previewArticle && (
                                            <Button color="secondary" variant="flat" onClick={() => void handleDownloadXiaohongshu(previewArticle)} startContent={<Icon icon="solar:download-minimalistic-bold" />}>
                                                一键下载
                                            </Button>
                                        )}
                                        {!isXiaohongshu && previewArticle && (
                                            <Button color="secondary" variant="flat" onClick={() => void handleCopyArticle(previewArticle)} startContent={<Icon icon="solar:copy-bold" />}>
                                                一键复制
                                            </Button>
                                        )}
                                        {allowEdit && (
                                            <Button color="secondary" variant="flat" onClick={handleStartEdit} startContent={<Icon icon="solar:pen-bold" />}>
                                                编辑排版
                                            </Button>
                                        )}
                                        <div className="flex-1" />
                                        <Button color="danger" variant="light" onClick={onClose}>
                                            关闭预览
                                        </Button>
                                        {allowPublish && previewArticle?.status === "draft" && (
                                            <Button color="primary" onClick={onClose} startContent={<Icon icon="solar:round-transfer-diagonal-bold" />}>
                                                立刻分发
                                            </Button>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <Button color="default" variant="light" onClick={() => setIsEditMode(false)} isDisabled={isSaving}>
                                            取消编辑
                                        </Button>
                                        <div className="flex-1" />
                                        <Button color="primary" onClick={handleSaveEdit} isLoading={isSaving} startContent={!isSaving && <Icon icon="solar:diskette-bold" />}>
                                            保存修改
                                        </Button>
                                    </>
                                )}
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>

            <Modal isOpen={isDeleteOpen} onOpenChange={onDeleteOpenChange} size="sm">
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader className="flex flex-col gap-1">确认删除</ModalHeader>
                            <ModalBody>
                                <p>您确定要删除{publishModalSubject} <strong>{articleToDelete?.title}</strong> 吗？</p>
                                <p className="text-small text-danger">此操作不可恢复。</p>
                            </ModalBody>
                            <ModalFooter>
                                <Button variant="light" onClick={onClose} isDisabled={isDeleting}>
                                    取消
                                </Button>
                                <Button color="danger" onClick={confirmDelete} isLoading={isDeleting}>
                                    确认删除
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>

            {allowPublish && (
                <Modal isOpen={isPublishOpen} onOpenChange={onPublishOpenChange} size="md">
                    <ModalContent>
                        {(onClose) => (
                            <>
                                <ModalHeader className="flex flex-col gap-1">分发推送</ModalHeader>
                                <ModalBody>
                                    <p>将{publishModalSubject} <strong>{articleToPublish?.title}</strong> 推送至以下关联平台账号：</p>
                                    {publishAccounts.length > 0 ? (
                                        <div className="mt-1 rounded-lg border border-divider overflow-hidden">
                                            <div className="grid grid-cols-2 bg-default-100 px-4 py-2 text-tiny text-default-500 font-semibold uppercase tracking-wide">
                                                <span>平台</span>
                                                <span>账号名称</span>
                                            </div>
                                            {publishAccounts.map((acc) => {
                                                const isSelected = selectedAccountId === acc.id;
                                                return (
                                                    <div
                                                        key={acc.id}
                                                        onClick={() => setSelectedAccountId(acc.id)}
                                                        className={[
                                                            "grid grid-cols-2 px-4 py-3 cursor-pointer transition-colors border-t border-divider text-sm",
                                                            isSelected
                                                                ? "bg-primary/10 text-primary font-semibold"
                                                                : "hover:bg-default-50 text-default-700",
                                                        ].join(" ")}
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            {isSelected && (
                                                                <Icon icon="solar:check-circle-bold" width={16} className="text-primary shrink-0" />
                                                            )}
                                                            {!isSelected && <span className="w-4 shrink-0" />}
                                                            {acc.platform}
                                                        </span>
                                                        <span>{acc.name}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="bg-warning-50 text-warning-600 p-3 rounded-md text-sm mt-2 font-semibold">
                                            暂未检测到配置的发布账号，请先前往 [账号配置] 页面添加。
                                        </div>
                                    )}
                                </ModalBody>
                                <ModalFooter>
                                    <Button variant="light" onClick={onClose} isDisabled={isPublishing}>
                                        取消
                                    </Button>
                                    <Button color="success" onClick={confirmPublish} isLoading={isPublishing} isDisabled={publishAccounts.length === 0}>
                                        执行发布
                                    </Button>
                                </ModalFooter>
                            </>
                        )}
                    </ModalContent>
                </Modal>
            )}
        </div>
    );
}
