import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Project } from "@/core/Project";
import {
  SearchScope,
  type TextMatchMode,
} from "@/core/service/dataManageService/contentSearchEngine/contentSearchEngine";
import { createSubWindow } from "@/core/subWindowOpen";
import { TabWorkspace } from "@/core/TabWorkspace";
import { activeResourceTabAtom } from "@/state";
import { cn } from "@/utils/cn";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { useAtom } from "jotai";
import {
  CaseSensitive,
  MessageCircleQuestionMark,
  Square,
  SquareDashedMousePointer,
  SquareDashedTopSolid,
  Telescope,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import i18next from "i18next";
import { useTranslation } from "react-i18next";

/**
 * 搜索内容的面板
 */
export default function FindWindow({ tabId }: { tabId: string }) {
  const { t } = useTranslation("findReplace");
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [matchMode, setMatchMode] = useState<TextMatchMode>("ordered");
  const [searchString, setSearchString] = useState("");
  const [replacementString, setReplacementString] = useState("");
  const [searchResults, setSearchResults] = useState<{ title: string; uuid: string }[]>([]);
  const [, setTick] = useState(0);
  // 是否开启快速瞭望模式
  const [isMouseEnterCameraMovable, setIsMouseEnterCameraMovable] = useState(false);
  // 搜索范围
  const [tab] = useAtom(activeResourceTabAtom);
  const project = tab instanceof Project ? tab : undefined;
  const defaultScope = project?.stageManager.getSelectedEntities().length ? SearchScope.SELECTED : SearchScope.ALL;
  const [scopeChoice, setScopeChoice] = useState({ project, scope: defaultScope });
  const searchScope = scopeChoice.project === project ? scopeChoice.scope : defaultScope;
  const setSearchScope = (scope: SearchScope) => setScopeChoice({ project, scope });

  const selectAllResult = () => {
    for (const result of searchResults) {
      const node = project?.stageManager.get(result.uuid);
      if (node) {
        node.isSelected = true;
      }
    }
    toast.success(`${searchResults.length} 个结果已全部选中`);
  };

  useEffect(() => {
    if (!project) return;
    project.contentSearch.isCaseSensitive = isCaseSensitive;
    project.contentSearch.matchMode = matchMode;
    project.contentSearch.searchScope = searchScope;
    project.contentSearch.startSearch(searchString, false);
    setSearchResults(
      project.contentSearch.searchResultNodes.map((node) => ({
        title: project.contentSearch.getStageObjectText(node),
        uuid: node.uuid,
      })),
    );
  }, [project, isCaseSensitive, matchMode, searchScope, searchString]);

  useEffect(() => {
    return () => {
      project?.contentSearch.startSearch("", false);
    };
  }, [project]);

  const replace = (all: boolean) => {
    if (!project) return;
    try {
      const result = project.contentSearch.replaceText(searchString, replacementString, all);
      setSearchResults(
        project.contentSearch.searchResultNodes.map((node) => ({
          title: project.contentSearch.getStageObjectText(node),
          uuid: node.uuid,
        })),
      );
      setTick((tick) => tick + 1);
      if (result.count) {
        toast.success(t("replaced", { objects: result.objectCount, count: result.count }));
      } else {
        toast.warning(t("noChanges"));
      }
      const next = project.contentSearch.searchResultNodes[project.contentSearch.currentSearchResultIndex];
      if (next) {
        project.contentSearch.panToResult(next);
      }
    } catch (error) {
      setSearchResults(
        project.contentSearch.searchResultNodes.map((node) => ({
          title: project.contentSearch.getStageObjectText(node),
          uuid: node.uuid,
        })),
      );
      toast.error(t("failed", { message: error instanceof Error ? error.message : String(error) }));
    }
  };

  if (!project) return <></>;
  const replacementStatus = project.contentSearch.getReplacementStatus(searchString);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-4">
      <div className="shrink-0 space-y-2">
        <Input
          placeholder="搜索文字；/问题 查问号结尾的节点和框，/空 查空白或默认编号，/okk 查绿标，/err 查红标"
          aria-label={t("findLabel")}
          autoFocus
          type="search"
          onChange={(e) => {
            setSearchString(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              void TabWorkspace.close(tabId);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) {
                project.contentSearch.previousSearchResult();
              } else {
                project.contentSearch.nextSearchResult();
              }
              setTick((t) => t + 1);
            }
          }}
          value={searchString}
        />
        <div role="group" aria-label={t("matchMode")} className="flex gap-2">
          <Button
            size="sm"
            variant={matchMode === "ordered" ? "default" : "outline"}
            aria-pressed={matchMode === "ordered"}
            onClick={() => setMatchMode("ordered")}
          >
            {t("orderedMatch")}
          </Button>
          <Button
            size="sm"
            variant={matchMode === "unordered" ? "default" : "outline"}
            aria-pressed={matchMode === "unordered"}
            onClick={() => setMatchMode("unordered")}
          >
            {t("unorderedMatch")}
          </Button>
        </div>
        {matchMode === "unordered" && <div className="text-muted-foreground text-xs">{t("unorderedHint")}</div>}
        <Input
          aria-label={t("replaceLabel")}
          placeholder={t("replacePlaceholder")}
          value={replacementString}
          onChange={(event) => setReplacementString(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              void TabWorkspace.close(tabId);
            } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (replacementStatus.hasCurrent) replace(false);
            }
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!replacementStatus.hasCurrent} onClick={() => replace(false)}>
            {t("replace")}
          </Button>
          <Button size="sm" disabled={replacementStatus.count === 0} onClick={() => replace(true)}>
            {t("replaceAll")}
          </Button>
        </div>
        <div className="text-muted-foreground text-xs">
          {t("matchCount", { count: replacementStatus.count })}
          {replacementStatus.lockedCount > 0 && t("lockedCount", { count: replacementStatus.lockedCount })}
          <div>{t("scopeHint")}</div>
          {replacementStatus.atEnd && <div>{t("atEnd")}</div>}
        </div>
        <div className="my-1 flex flex-wrap gap-3">
          <Tooltip>
            <TooltipTrigger>
              <Button
                size="icon"
                variant={isCaseSensitive ? "default" : "outline"}
                onClick={() => {
                  const currentResult = !isCaseSensitive;
                  setIsCaseSensitive(currentResult);
                }}
              >
                <CaseSensitive />
              </Button>
            </TooltipTrigger>
            <TooltipContent>区分大小写</TooltipContent>
          </Tooltip>

          {/* 搜索范围选择按钮组 */}
          <Tooltip>
            <TooltipTrigger>
              <Button
                size="icon"
                variant={searchScope === SearchScope.ALL ? "default" : "outline"}
                onClick={() => {
                  setSearchScope(SearchScope.ALL);
                }}
              >
                <Square />
              </Button>
            </TooltipTrigger>
            <TooltipContent>搜索整个舞台</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger>
              <Button
                size="icon"
                variant={searchScope === SearchScope.SELECTED ? "default" : "outline"}
                onClick={() => {
                  setSearchScope(SearchScope.SELECTED);
                }}
              >
                <SquareDashedTopSolid />
              </Button>
            </TooltipTrigger>
            <TooltipContent>只搜索选中的内容</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger>
              <Button
                size="icon"
                variant={searchScope === SearchScope.SELECTED_BOUNDS ? "default" : "outline"}
                onClick={() => {
                  setSearchScope(SearchScope.SELECTED_BOUNDS);
                }}
              >
                <SquareDashedMousePointer />
              </Button>
            </TooltipTrigger>
            <TooltipContent>搜索选中内容的外接矩形范围</TooltipContent>
          </Tooltip>

          {searchResults.length > 0 && (
            <Tooltip>
              <TooltipTrigger>
                <Button size="icon" variant="outline" onClick={selectAllResult}>
                  <SquareDashedTopSolid strokeWidth={1.5} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>将全部结果选中</TooltipContent>
            </Tooltip>
          )}

          {searchResults.length >= 3 && (
            <Tooltip>
              <TooltipTrigger>
                <Button
                  size="icon"
                  variant={isMouseEnterCameraMovable ? "default" : "outline"}
                  onClick={() => {
                    setIsMouseEnterCameraMovable(!isMouseEnterCameraMovable);
                  }}
                >
                  <Telescope />
                </Button>
              </TooltipTrigger>
              <TooltipContent>快速瞭望模式</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger>
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  Dialog.confirm(t("helpTitle"), t("help"));
                }}
              >
                <MessageCircleQuestionMark />
              </Button>
            </TooltipTrigger>
            <TooltipContent>使用说明</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div
        aria-label={t("resultsLabel")}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain"
        onWheel={(event) => event.stopPropagation()}
      >
        {searchString === "" && <div className="text-center">请输入搜索内容</div>}
        {searchResults.length === 0 && searchString !== "" && (
          <div className="text-center">没有搜索结果:`{searchString}`</div>
        )}
        {searchResults.map((result, index) => (
          <div
            key={result.uuid}
            className={cn(
              "hover:text-panel-success-text shrink-0 cursor-pointer text-xs break-words whitespace-pre-wrap hover:underline",
              index === project.contentSearch.currentSearchResultIndex &&
                "bg-accent/60 ring-accent rounded-sm ring-2 ring-inset",
            )}
            onMouseEnter={() => {
              project.controller.resetCountdownTimer();
              if (isMouseEnterCameraMovable) {
                const node = project.stageManager.get(result.uuid);
                if (node) {
                  project.contentSearch.panToResult(node);
                }
              }
            }}
            onClick={() => {
              project.controller.resetCountdownTimer();
              project.contentSearch.chooseSearchResult(index);
              setTick((tick) => tick + 1);
              const node = project.stageManager.get(result.uuid);
              if (node) {
                project.contentSearch.panToResult(node, true);
              }
            }}
          >
            <span className="bg-secondary mr-2 rounded-sm px-2">{index + 1}</span>
            {result.title}
          </div>
        ))}
      </div>
    </div>
  );
}

FindWindow.open = () => {
  createSubWindow("FindWindow", {
    title: i18next.t("title", { ns: "findReplace" }),
    contextTarget: "activeResourceTab",
    children: (tab) => <FindWindow tabId={tab.id} />,
    rect: new Rectangle(new Vector(100, 100), new Vector(300, 600)),
  });
};
