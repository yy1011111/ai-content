'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, Switch, Input, Button, Spinner, Divider, Select, SelectItem } from '@heroui/react';
import { Icon } from '@iconify/react';
import { toast } from 'react-hot-toast';
import { publishingApi, PublishAccount } from '@/lib/api/publishing';
import { schedulesApi, type CreateArticlesScheduleConfig, type ScheduleConfig } from '@/lib/api/schedules';

const parseCron = (cron: string) => {
    if (!cron) return { mode: 'custom', value: '' };

    const dailyMatch = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
    if (dailyMatch) {
        const mm = dailyMatch[1].padStart(2, '0');
        const hh = dailyMatch[2].padStart(2, '0');
        return { mode: 'daily', value: `${hh}:${mm}` };
    }

    const hourlyMatch = cron.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
    if (hourlyMatch) {
        return { mode: 'hourly', value: hourlyMatch[1] };
    }

    return { mode: 'custom', value: cron };
};

const buildCron = (mode: string, value: string, oldCron: string) => {
    if (mode === 'daily') {
        const [hh, mm] = (value || '00:00').split(':');
        return `${Number(mm)} ${Number(hh)} * * *`;
    }
    if (mode === 'hourly') {
        return `0 */${value || 1} * * *`;
    }
    return oldCron;
};

const taskTypeMap: Record<string, { title: string; desc: string; icon: string }> = {
    collect_materials: {
        title: '自动采集素材',
        desc: '从所有已启用的信息源定期获取最新内容',
        icon: 'solar:cloud-download-linear',
    },
    mine_materials: {
        title: '自动挖掘素材',
        desc: '批量利用大模型加工并提炼未处理的素材',
        icon: 'solar:magic-stick-3-linear',
    },
    create_articles: {
        title: '自动生成内容',
        desc: '从就绪的精选选题中按默认风格批量生成文章或小红书草稿',
        icon: 'solar:document-text-linear',
    },
};

export default function SchedulesPage() {
    const [configs, setConfigs] = useState<ScheduleConfig[]>([]);
    const [publishAccounts, setPublishAccounts] = useState<PublishAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingTask, setSavingTask] = useState<string | null>(null);

    useEffect(() => {
        fetchSchedules();
        fetchPublishAccounts();
    }, []);

    const fetchSchedules = async () => {
        try {
            setLoading(true);
            const data = await schedulesApi.list();
            setConfigs(data || []);
        } catch {
            toast.error('获取系统调度配置失败');
        } finally {
            setLoading(false);
        }
    };

    const fetchPublishAccounts = async () => {
        try {
            const data = await publishingApi.getAccounts();
            setPublishAccounts(data.filter((account) => account.platform === 'wechat'));
        } catch {
            toast.error('获取发布账号失败');
        }
    };

    const handleUpdate = async (config: ScheduleConfig) => {
        const createContentType = config.config?.contentType === 'xiaohongshu' ? 'xiaohongshu' : 'article';

        if (config.taskType === 'create_articles' && createContentType === 'xiaohongshu' && config.config?.autoPublish) {
            toast.error('小红书自动生成任务当前仅支持保留草稿，暂不支持自动发布');
            return;
        }

        if (config.taskType === 'create_articles' && config.config?.autoPublish && !config.config?.publishAccountId) {
            toast.error('已开启自动发布，请先选择一个公众号账号');
            return;
        }

        try {
            setSavingTask(config.taskType);
            await schedulesApi.update(config.taskType, {
                cronExpr: config.cronExpr,
                enabled: config.enabled,
                config: config.config,
            });
            toast.success(`${taskTypeMap[config.taskType]?.title || '任务'}设置已保存`);
            await fetchSchedules();
        } catch {
            toast.error('请求失败');
        } finally {
            setSavingTask(null);
        }
    };

    const handleChange = (
        taskType: string,
        field: keyof ScheduleConfig,
        value: string | boolean | CreateArticlesScheduleConfig | undefined,
    ) => {
        setConfigs((prev) =>
            prev.map((c) => (c.taskType === taskType ? { ...c, [field]: value } : c))
        );
    };

    if (loading) {
        return (
            <div className="flex w-full h-[50vh] items-center justify-center">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col gap-6 p-6">
            <div>
                <h1 className="text-2xl font-bold">计划任务</h1>
                <p className="text-default-500 mt-2">
                    配置系统的定时自动任务行为。这些任务将在后台以设定的频率运行。
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {configs.map((config) => {
                    const meta = taskTypeMap[config.taskType] || {
                        title: config.taskType,
                        desc: '未知的系统任务',
                        icon: 'solar:settings-linear',
                    };
                    const createContentType = config.config?.contentType === 'xiaohongshu' ? 'xiaohongshu' : 'article';
                    const isXiaohongshuTask = config.taskType === 'create_articles' && createContentType === 'xiaohongshu';

                    return (
                        <Card key={config.taskType} className="w-full">
                            <CardHeader className="flex gap-3 px-5 pt-5 pb-3 justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                        <Icon icon={meta.icon} width={24} />
                                    </div>
                                    <div className="flex flex-col">
                                        <p className="text-md font-bold">{meta.title}</p>
                                        <p className="text-small text-default-500 line-clamp-2" title={meta.desc}>
                                            {meta.desc}
                                        </p>
                                    </div>
                                </div>
                                <Switch
                                    isSelected={config.enabled}
                                    onValueChange={(val) => handleChange(config.taskType, 'enabled', val)}
                                    color="primary"
                                />
                            </CardHeader>
                            <Divider />
                            <CardBody className="px-5 py-4 flex flex-col gap-4">
                                {(() => {
                                    const parsed = parseCron(config.cronExpr);
                                    return (
                                        <div className="flex flex-col gap-3">
                                            <Select
                                                label="运行频率"
                                                selectedKeys={[parsed.mode]}
                                                onSelectionChange={(keys) => {
                                                    const newMode = Array.from(keys)[0] as string;
                                                    if (!newMode || newMode === parsed.mode) return;

                                                    let newCron = config.cronExpr;
                                                    if (newMode === 'daily') newCron = '0 0 * * *';
                                                    else if (newMode === 'hourly') newCron = '0 */1 * * *';

                                                    handleChange(config.taskType, 'cronExpr', newCron);
                                                }}
                                                size="sm"
                                                variant="bordered"
                                                isDisabled={!config.enabled}
                                                disallowEmptySelection
                                            >
                                                <SelectItem key="hourly">每隔几小时</SelectItem>
                                                <SelectItem key="daily">每天固定时间</SelectItem>
                                                <SelectItem key="custom">高级 (自定义 Cron)</SelectItem>
                                            </Select>

                                            {parsed.mode === 'hourly' && (
                                                <Input
                                                    type="number"
                                                    label="间隔小时数"
                                                    min={1}
                                                    max={23}
                                                    value={parsed.value}
                                                    onValueChange={(val) => {
                                                        handleChange(config.taskType, 'cronExpr', buildCron('hourly', val, config.cronExpr));
                                                    }}
                                                    size="sm"
                                                    variant="bordered"
                                                    isDisabled={!config.enabled}
                                                />
                                            )}

                                            {parsed.mode === 'daily' && (
                                                <Input
                                                    type="time"
                                                    label="执行时间"
                                                    value={parsed.value}
                                                    onValueChange={(val) => {
                                                        handleChange(config.taskType, 'cronExpr', buildCron('daily', val, config.cronExpr));
                                                    }}
                                                    size="sm"
                                                    variant="bordered"
                                                    isDisabled={!config.enabled}
                                                />
                                            )}

                                            {parsed.mode === 'custom' && (
                                                <Input
                                                    label="Cron 表达式"
                                                    placeholder="如: 0 * * * *"
                                                    value={config.cronExpr}
                                                    onValueChange={(val) => handleChange(config.taskType, 'cronExpr', val)}
                                                    description="支持标准的 5 位或 6 位 Cron 格式"
                                                    variant="bordered"
                                                    size="sm"
                                                    isDisabled={!config.enabled}
                                                />
                                            )}
                                        </div>
                                    );
                                })()}

                                {config.taskType === 'create_articles' && (
                                    <div className="flex flex-col gap-3 mt-1 pt-3 border-t border-dashed border-default-200">
                                        <p className="text-xs font-semibold text-default-500">生成类型</p>
                                        <Select
                                            label="内容类型"
                                            selectedKeys={[createContentType]}
                                            onSelectionChange={(keys) => {
                                                const selected = Array.from(keys)[0] as 'article' | 'xiaohongshu' | undefined;
                                                if (!selected) return;
                                                handleChange(config.taskType, 'config', {
                                                    ...config.config,
                                                    contentType: selected,
                                                    autoPublish: selected === 'article' ? Boolean(config.config?.autoPublish) : false,
                                                    publishAccountId: selected === 'article' ? config.config?.publishAccountId || '' : '',
                                                });
                                            }}
                                            size="sm"
                                            variant="bordered"
                                            isDisabled={!config.enabled}
                                            disallowEmptySelection
                                        >
                                            <SelectItem key="article">公众号文章</SelectItem>
                                            <SelectItem key="xiaohongshu">小红书笔记</SelectItem>
                                        </Select>

                                        <p className="text-xs font-semibold text-default-500">生成门槛卡控保护</p>
                                        <div className="flex gap-3">
                                            <Input
                                                type="number"
                                                label="最低 AI 评分"
                                                description="低于该分的选题将不被处理"
                                                value={config.config?.minScore?.toString() || '80'}
                                                onValueChange={(val) => handleChange(config.taskType, 'config', { ...config.config, minScore: Number(val) })}
                                                size="sm"
                                                variant="bordered"
                                                min={0}
                                                max={100}
                                                isDisabled={!config.enabled}
                                                className="flex-1"
                                            />
                                            <Input
                                                type="number"
                                                label="单次最大篇数"
                                                description="避免批量超流"
                                                value={config.config?.limit?.toString() || '5'}
                                                onValueChange={(val) => handleChange(config.taskType, 'config', { ...config.config, limit: Number(val) })}
                                                size="sm"
                                                variant="bordered"
                                                min={1}
                                                max={50}
                                                isDisabled={!config.enabled}
                                                className="flex-1"
                                            />
                                        </div>

                                        <div className="mt-2 rounded-medium border border-default-200 p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-semibold">生成后自动发布</p>
                                                    <p className="text-xs text-default-500">
                                                        {isXiaohongshuTask
                                                            ? '当前小红书任务只会自动生成草稿，不会直接发布。'
                                                            : '开启后，会将本轮新生成的草稿直接发布到选定的公众号账号。'}
                                                    </p>
                                                </div>
                                                <Switch
                                                    isSelected={!isXiaohongshuTask && Boolean(config.config?.autoPublish)}
                                                    onValueChange={(val) =>
                                                        handleChange(config.taskType, 'config', {
                                                            ...config.config,
                                                            autoPublish: val,
                                                            publishAccountId: val ? config.config?.publishAccountId || '' : '',
                                                        })
                                                    }
                                                    color="primary"
                                                    isDisabled={!config.enabled || isXiaohongshuTask}
                                                />
                                            </div>

                                            {!isXiaohongshuTask && config.config?.autoPublish && (
                                                <Select
                                                    className="mt-3"
                                                    label="发布到公众号账号"
                                                    placeholder={publishAccounts.length > 0 ? '请选择一个公众号账号' : '暂无可用公众号账号'}
                                                    selectedKeys={config.config?.publishAccountId ? [config.config.publishAccountId] : []}
                                                    onChange={(e) =>
                                                        handleChange(config.taskType, 'config', {
                                                            ...config.config,
                                                            publishAccountId: e.target.value,
                                                        })
                                                    }
                                                    size="sm"
                                                    variant="bordered"
                                                    isDisabled={!config.enabled || publishAccounts.length === 0}
                                                >
                                                    {publishAccounts.map((account) => (
                                                        <SelectItem key={account.id}>
                                                            {account.name}
                                                        </SelectItem>
                                                    ))}
                                                </Select>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="flex justify-between items-center mt-2">
                                    <p className="text-xs text-default-400">
                                        上次运行: {config.lastRunTime ? new Date(config.lastRunTime).toLocaleString() : '从未运行'}
                                    </p>
                                    <Button
                                        size="sm"
                                        color="primary"
                                        variant="flat"
                                        isLoading={savingTask === config.taskType}
                                        onPress={() => handleUpdate(config)}
                                    >
                                        保存配置
                                    </Button>
                                </div>
                            </CardBody>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
