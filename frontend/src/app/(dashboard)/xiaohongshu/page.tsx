"use client";

import { ContentLibraryPage } from "../components/content-library-page";

export default function XiaohongshuPage() {
    return (
        <ContentLibraryPage
            contentType="xiaohongshu"
            title="小红书笔记"
            description="查看基于选题自动生成的小红书笔记草稿，支持预览、下载，并可一键推送到小红书创作后台辅助发布。"
            searchPlaceholder="搜索小红书笔记..."
            totalLabel="共 {count} 篇笔记"
            emptyLabel="当前还没有小红书笔记记录"
            deleteLabel="删除笔记"
            publishLabel="推送到创作台"
            previewTitle="小红书笔记预览"
            publishModalSubject="笔记"
            allowPublish
            allowEdit={false}
        />
    );
}
