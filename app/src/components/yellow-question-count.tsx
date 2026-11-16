import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { isYellowQuestionNode } from "@/core/render/canvas2d/questionColor";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { activeResourceTabAtom } from "@/state";

export default function YellowQuestionCount() {
  const active = useAtomValue(activeResourceTabAtom);
  const project = active instanceof Project ? active : undefined;
  const [enabled] = Settings.use("showYellowQuestionCount");
  const [yellowEnabled] = Settings.use("questionMarkYellow");
  const [snapshot, setSnapshot] = useState<{ project?: Project; count: number }>({ count: 0 });
  const { t } = useTranslation("statusIndicators");

  useEffect(() => {
    if (!enabled || !project || project.closing) return;
    let disposed = false;
    let queued = false;
    const refresh = () => {
      let count = 0;
      for (const node of project.stage) {
        if (node instanceof TextNode && isYellowQuestionNode(node.text)) count++;
      }
      setSnapshot((previous) =>
        previous.project === project && previous.count === count ? previous : { project, count },
      );
    };
    const changed = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!disposed) refresh();
      });
    };
    refresh();
    project.on("stage-content-change", changed);
    project.on("stage-commit", changed);
    return () => {
      disposed = true;
      project.off("stage-content-change", changed);
      project.off("stage-commit", changed);
    };
  }, [enabled, yellowEnabled, project]);

  if (!enabled || !project || project.closing) return null;
  return (
    <span
      data-yellow-question-count=""
      className="text-muted-foreground pointer-events-none absolute right-2 bottom-1 z-30 text-xs leading-none tabular-nums select-none"
    >
      {t("yellowQuestions", { count: snapshot.project === project ? snapshot.count : 0 })}
    </span>
  );
}
