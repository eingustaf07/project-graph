import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings } from "@/core/service/Settings";
import { invoke } from "@tauri-apps/api/core";
import { Unplug } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type ConnectionStatus = { connected: boolean; email?: string; hasPlanAccess: boolean; expired?: boolean };
type AccountModel = { slug: string; display_name: string };

export function ChatGPTConnectionSettings() {
  const { t } = useTranslation("settings");
  const [mode, setMode] = Settings.use("aiConnectionMode");
  const [selectedModel, setSelectedModel] = Settings.use("aiChatGPTModel");
  const [status, setStatus] = useState<ConnectionStatus>({ connected: false, hasPlanAccess: false });
  const [models, setModels] = useState<AccountModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [showPlanNotice, setShowPlanNotice] = useState(false);
  const selectedModelRef = useRef(selectedModel);
  const setSelectedModelRef = useRef(setSelectedModel);
  selectedModelRef.current = selectedModel;
  setSelectedModelRef.current = setSelectedModel;

  const refreshStatus = useCallback(async () => {
    try {
      const next = await invoke<ConnectionStatus>("chatgpt_connection_status");
      setStatus(next);
      if (next.connected && next.hasPlanAccess) {
        const available = await invoke<AccountModel[]>("chatgpt_list_models");
        setModels(available);
        if (available[0] && !available.some((model) => model.slug === selectedModelRef.current)) {
          setSelectedModelRef.current(available[0].slug);
        }
      } else {
        setModels([]);
      }
    } catch (error) {
      if (String(error).includes("连接已过期")) {
        setStatus({ connected: false, hasPlanAccess: false, expired: true });
      }
      setModels([]);
      throw error;
    }
  }, []);

  useEffect(() => {
    void refreshStatus().catch((error) => toast.error(String(error)));
  }, [refreshStatus]);

  useEffect(() => {
    if (mode !== "chatgpt" || !status.connected || !status.hasPlanAccess) return;
    if (window.localStorage.getItem("project-graph.chatgpt-plan-notice-seen") !== "true") setShowPlanNotice(true);
  }, [mode, status.connected, status.hasPlanAccess]);

  const connect = async () => {
    setBusy(true);
    try {
      const next = await invoke<ConnectionStatus>("chatgpt_start_login");
      setStatus(next);
      if (!next.hasPlanAccess) {
        setModels([]);
        toast.error(t("chatgpt.authorizationRequired"));
      } else {
        toast.success(t("chatgpt.connected"));
        await refreshStatus().catch((error) => toast.error(String(error)));
      }
    } catch (error) {
      toast.error(`${t("chatgpt.authorizationFailed")}: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const warning = await invoke<string | null>("chatgpt_disconnect");
      setStatus({ connected: false, hasPlanAccess: false });
      setModels([]);
      if (mode === "chatgpt") setMode("api");
      if (warning) toast.warning(warning);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Field
      title={t("chatgpt.title")}
      description={t("chatgpt.description")}
      icon={<Unplug className="h-4 w-4" />}
      className="border-accent border-b"
    >
      <div className="flex flex-col items-end gap-2">
        <span className="text-sm">
          {status.connected
            ? `${t("chatgpt.connected")}${status.email ? ` · ${status.email}` : ""}`
            : status.expired
              ? t("chatgpt.expired")
              : t("chatgpt.notConnected")}
        </span>
        {status.connected && status.hasPlanAccess && models.length > 0 && (
          <Select value={selectedModel || models[0].slug} onValueChange={setSelectedModel}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={t("chatgpt.chooseModel")} />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.slug} value={model.slug}>
                  {model.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {status.connected ? (
          <Button variant="outline" disabled={busy} onClick={() => void disconnect()}>
            {t("chatgpt.disconnect")}
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void connect()}>
            {t("chatgpt.signIn")}
          </Button>
        )}
        {status.connected && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void connect()}>
            {t("chatgpt.reconnect")}
          </Button>
        )}
      </div>
    </Field>
    <AlertDialog open={showPlanNotice} onOpenChange={setShowPlanNotice}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("chatgpt.planNoticeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("chatgpt.planNoticeDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={() => {
              window.localStorage.setItem("project-graph.chatgpt-plan-notice-seen", "true");
              setShowPlanNotice(false);
            }}
          >
            {t("chatgpt.gotIt")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
