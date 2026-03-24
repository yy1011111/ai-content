"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  addToast,
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  useDisclosure,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { PublishAccount, publishingApi } from "@/lib/api/publishing";

type FormState = {
  name: string;
  platform: "wechat" | "xiaohongshu";
  appId: string;
  apiToken: string;
  config: {
    openComment: number;
    onlyFansCanComment: number;
  };
};

const createInitialForm = (): FormState => ({
  name: "",
  platform: "wechat",
  appId: "",
  apiToken: "",
  config: {
    openComment: 1,
    onlyFansCanComment: 0,
  },
});

const platformLabelMap: Record<string, string> = {
  wechat: "微信公众号",
  xiaohongshu: "小红书",
};

export default function AccountsPage() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PublishAccount | null>(null);
  const [formData, setFormData] = useState<FormState>(createInitialForm());
  const [loginStatusMap, setLoginStatusMap] = useState<Record<string, boolean | null>>({});
  const [accountActionLoading, setAccountActionLoading] = useState<Record<string, boolean>>({});

  const loadAccounts = async () => {
    setIsLoading(true);
    try {
      const data = await publishingApi.getAccounts();
      setAccounts(data);
    } catch (error) {
      addToast({
        title: "加载发布账号失败",
        description: error instanceof Error ? error.message : "未知错误",
        color: "danger",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  const resetForm = () => {
    setEditingAccount(null);
    setFormData(createInitialForm());
  };

  const openCreateModal = () => {
    resetForm();
    onOpen();
  };

  const openEditModal = (account: PublishAccount) => {
    setEditingAccount(account);
    setFormData({
      name: account.name || "",
      platform: (account.platform as "wechat" | "xiaohongshu") || "wechat",
      appId: account.appId || "",
      apiToken: account.apiToken || "",
      config: {
        openComment: account.config?.openComment ?? 1,
        onlyFansCanComment: account.config?.onlyFansCanComment ?? 0,
      },
    });
    onOpen();
  };

  const closeModal = () => {
    onClose();
    resetForm();
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      addToast({ title: "请先填写账号名称", color: "warning" });
      return;
    }

    if (formData.platform === "wechat" && (!formData.appId.trim() || !formData.apiToken.trim())) {
      addToast({ title: "微信公众号账号需要填写 AppID 和 AppSecret", color: "warning" });
      return;
    }

    setIsSaving(true);
    try {
      const payload =
        formData.platform === "wechat"
          ? {
              name: formData.name.trim(),
              platform: formData.platform,
              appId: formData.appId.trim(),
              apiToken: formData.apiToken.trim(),
              config: {
                openComment: formData.config.openComment,
                onlyFansCanComment: formData.config.onlyFansCanComment,
              },
            }
          : {
              name: formData.name.trim(),
              platform: formData.platform,
              config: {
                creatorUrl: "https://creator.xiaohongshu.com/publish/publish",
              },
            };

      if (editingAccount) {
        await publishingApi.updateAccount(editingAccount.id, payload);
        addToast({ title: "账号更新成功", color: "success" });
      } else {
        await publishingApi.createAccount(payload);
        addToast({ title: "账号添加成功", color: "success" });
      }

      closeModal();
      await loadAccounts();
    } catch (error) {
      addToast({
        title: editingAccount ? "账号更新失败" : "账号添加失败",
        description: error instanceof Error ? error.message : "未知错误",
        color: "danger",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (account: PublishAccount) => {
    if (!window.confirm(`确定要删除账号「${account.name}」吗？`)) {
      return;
    }

    try {
      await publishingApi.deleteAccount(account.id);
      addToast({ title: "账号删除成功", color: "success" });
      await loadAccounts();
    } catch (error) {
      addToast({
        title: "账号删除失败",
        description: error instanceof Error ? error.message : "未知错误",
        color: "danger",
      });
    }
  };

  const setLoadingForAccount = (accountId: string, loading: boolean) => {
    setAccountActionLoading((current) => ({ ...current, [accountId]: loading }));
  };

  const handleTestConnection = async (account: PublishAccount) => {
    setLoadingForAccount(account.id, true);
    try {
      const result = await publishingApi.testAccountConnection(account.id);
      addToast({
        title: result.success ? "连接测试成功" : "连接测试未通过",
        description: result.message,
        color: result.success ? "success" : "warning",
      });
    } catch (error) {
      addToast({
        title: "测试连接失败",
        description: error instanceof Error ? error.message : "未知错误",
        color: "danger",
      });
    } finally {
      setLoadingForAccount(account.id, false);
    }
  };

  const handleXiaohongshuLogin = async (account: PublishAccount) => {
    setLoadingForAccount(account.id, true);
    try {
      const result = await publishingApi.startXiaohongshuLogin(account.id);
      addToast({
        title: result.success ? "登录状态可用" : "需要登录创作后台",
        description: result.message,
        color: result.success ? "success" : "warning",
      });
    } catch (error) {
      addToast({
        title: "打开小红书创作后台失败",
        description: error instanceof Error ? error.message : "未知错误",
        color: "danger",
      });
    } finally {
      setLoadingForAccount(account.id, false);
    }
  };

  const handleCheckXiaohongshuStatus = async (account: PublishAccount) => {
    setLoadingForAccount(account.id, true);
    try {
      const result = await publishingApi.getXiaohongshuStatus(account.id);
      setLoginStatusMap((current) => ({ ...current, [account.id]: result.loggedIn }));
      addToast({
        title: result.loggedIn ? "创作后台已登录" : "创作后台未登录",
        description: result.loggedIn
          ? "可以继续从系统内发起小红书辅助发布。"
          : "请先点击“登录创作后台”，完成一次登录授权。",
        color: result.loggedIn ? "success" : "warning",
      });
    } catch (error) {
      addToast({
        title: "检查小红书登录状态失败",
        description: error instanceof Error ? error.message : "未知错误",
        color: "danger",
      });
    } finally {
      setLoadingForAccount(account.id, false);
    }
  };

  const platformHelpText = useMemo(() => {
    if (formData.platform === "wechat") {
      return "微信公众号使用官方草稿箱接口。这里填写的就是公众号 AppID 和 AppSecret，不再依赖第三方发布地址。";
    }

    return "小红书发布会复用服务器上的创作后台登录态。首次使用前，请先保存账号，再点击“登录创作后台”完成一次登录授权。";
  }, [formData.platform]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1100px] mx-auto pb-10">
      <header className="rounded-medium border-small border-white/10 flex items-center justify-between gap-3 p-5 bg-background/60 backdrop-blur-md shadow-sm">
        <div className="flex flex-col">
          <h2 className="text-xl text-default-900 font-bold">发布账号配置</h2>
          <span className="text-small text-default-500 mt-1">
            统一管理微信公众号与小红书账号。发布内容时，系统会从这里读取授权配置。
          </span>
        </div>
        <Button color="primary" onClick={openCreateModal} startContent={<Icon icon="solar:add-circle-bold" />}>
          添加账号
        </Button>
      </header>

      <Table aria-label="发布账号列表" className="border-small border-white/10 rounded-medium">
        <TableHeader>
          <TableColumn>平台</TableColumn>
          <TableColumn>账号名称</TableColumn>
          <TableColumn>关键标识</TableColumn>
          <TableColumn>状态</TableColumn>
          <TableColumn align="center">操作</TableColumn>
        </TableHeader>
        <TableBody emptyContent={isLoading ? <Spinner /> : "暂未配置任何发布账号"} items={accounts}>
          {(item) => {
            const cachedStatus = loginStatusMap[item.id];
            const isBusy = Boolean(accountActionLoading[item.id]);

            return (
              <TableRow key={item.id}>
                <TableCell>
                  <Chip
                    color={item.platform === "wechat" ? "success" : "secondary"}
                    variant="flat"
                    size="sm"
                    startContent={
                      <Icon
                        icon={item.platform === "wechat" ? "fa-brands:weixin" : "simple-icons:xiaohongshu"}
                        width={14}
                      />
                    }
                  >
                    {platformLabelMap[item.platform] || item.platform}
                  </Chip>
                </TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.platform === "wechat" ? item.appId || "-" : "创作后台登录态"}</TableCell>
                <TableCell>
                  {item.platform === "wechat" ? (
                    <Chip size="sm" variant="flat" color="success">
                      已配置
                    </Chip>
                  ) : cachedStatus === null || cachedStatus === undefined ? (
                    <Chip size="sm" variant="flat" color="default">
                      未检测
                    </Chip>
                  ) : cachedStatus ? (
                    <Chip size="sm" variant="flat" color="success">
                      创作后台已登录
                    </Chip>
                  ) : (
                    <Chip size="sm" variant="flat" color="warning">
                      创作后台未登录
                    </Chip>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="flat"
                      color={item.platform === "wechat" ? "success" : "default"}
                      isLoading={isBusy}
                      onClick={() => void handleTestConnection(item)}
                    >
                      测试连接
                    </Button>
                    {item.platform === "xiaohongshu" && (
                      <>
                        <Button
                          size="sm"
                          variant="flat"
                          color="secondary"
                          isLoading={isBusy}
                          onClick={() => void handleXiaohongshuLogin(item)}
                        >
                          登录创作后台
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          isLoading={isBusy}
                          onClick={() => void handleCheckXiaohongshuStatus(item)}
                        >
                          检查状态
                        </Button>
                      </>
                    )}
                    <Button isIconOnly size="sm" variant="light" onClick={() => openEditModal(item)}>
                      <Icon icon="solar:pen-linear" width={18} />
                    </Button>
                    <Button isIconOnly size="sm" variant="light" color="danger" onClick={() => void handleDelete(item)}>
                      <Icon icon="solar:trash-bin-trash-linear" width={18} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          }}
        </TableBody>
      </Table>

      <Modal isOpen={isOpen} onClose={closeModal} size="2xl">
        <ModalContent>
          <ModalHeader>{editingAccount ? "编辑发布账号" : "添加发布账号"}</ModalHeader>
          <ModalBody className="gap-4">
            <Select
              label="所属平台"
              selectedKeys={[formData.platform]}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as "wechat" | "xiaohongshu";
                setFormData((current) => ({ ...current, platform: selected || "wechat" }));
              }}
              disallowEmptySelection
            >
              <SelectItem key="wechat">微信公众号</SelectItem>
              <SelectItem key="xiaohongshu">小红书</SelectItem>
            </Select>

            <Input
              label="配置名称"
              placeholder={formData.platform === "wechat" ? "例如：主公众号" : "例如：小红书主账号"}
              value={formData.name}
              onValueChange={(value) => setFormData((current) => ({ ...current, name: value }))}
            />

            {formData.platform === "wechat" ? (
              <>
                <Input
                  label="AppID"
                  placeholder="请输入公众号 AppID"
                  value={formData.appId}
                  onValueChange={(value) => setFormData((current) => ({ ...current, appId: value }))}
                />
                <Input
                  label="AppSecret"
                  type="password"
                  placeholder="请输入公众号 AppSecret"
                  value={formData.apiToken}
                  onValueChange={(value) => setFormData((current) => ({ ...current, apiToken: value }))}
                />
                <Select
                  label="开启留言"
                  selectedKeys={[String(formData.config.openComment)]}
                  onSelectionChange={(keys) => {
                    const selected = Number(Array.from(keys)[0] || 1);
                    setFormData((current) => ({
                      ...current,
                      config: { ...current.config, openComment: selected },
                    }));
                  }}
                  disallowEmptySelection
                >
                  <SelectItem key="1">是</SelectItem>
                  <SelectItem key="0">否</SelectItem>
                </Select>
                <Select
                  label="仅粉丝可留言"
                  selectedKeys={[String(formData.config.onlyFansCanComment)]}
                  onSelectionChange={(keys) => {
                    const selected = Number(Array.from(keys)[0] || 0);
                    setFormData((current) => ({
                      ...current,
                      config: { ...current.config, onlyFansCanComment: selected },
                    }));
                  }}
                  disallowEmptySelection
                >
                  <SelectItem key="0">否</SelectItem>
                  <SelectItem key="1">是</SelectItem>
                </Select>
              </>
            ) : (
              <div className="rounded-large border border-white/10 bg-default-100/40 px-4 py-4 text-sm text-default-600">
                小红书账号不需要填写 AppID / AppSecret。保存后请点击列表里的“登录创作后台”，在弹出的浏览器窗口里完成一次登录授权，
                后续系统就能帮你准备发布素材包并打开创作台。
              </div>
            )}

            <div className="rounded-large border border-white/10 bg-default-100/40 px-4 py-3 text-sm text-default-500">
              {platformHelpText}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onClick={closeModal} isDisabled={isSaving}>
              取消
            </Button>
            <Button color="primary" onClick={() => void handleSave()} isLoading={isSaving}>
              保存配置
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
