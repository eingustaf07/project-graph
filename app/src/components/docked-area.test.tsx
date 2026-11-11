// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("@/ProjectTabs", () => ({ ProjectTabs: () => null }));
vi.mock("@/state", () => ({}));
vi.mock("@/core/TabWorkspace", () => ({ TabWorkspace: {} }));
vi.mock("@/core/service/Settings", () => ({ Settings: {} }));
vi.mock("@/core/service/Telemetry", () => ({ Telemetry: {} }));
import { Tab } from "@/core/Tab";
import { TabGroupContent } from "./docked-area";

it("keeps visited project surfaces and edit state through 100 rapid tab switches, mounting each once", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const mounts = vi.fn(),
    renders = vi.fn(),
    unmounts = vi.fn();
  class ProjectTab extends Tab {
    uri = "draft:test";
    component = () => {
      renders(this.id);
      const [value] = useState(() => this.id);
      useEffect(() => {
        mounts(this.id);
        return () => {
          unmounts(this.id);
        };
      }, []);
      return <canvas data-draft={value} />;
    };
    getComponent() {
      return this.component;
    }
  }
  const tabs = [new ProjectTab({}), new ProjectTab({}), new ProjectTab({})];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    for (let i = 0; i < 100; i++) {
      await act(() => root.render(<TabGroupContent tabs={tabs} activeTab={tabs[i % 2]} />));
      expect(host.querySelectorAll("canvas")).toHaveLength(i === 0 ? 1 : 2);
      const visible = host.querySelector<HTMLDivElement>("div:not([hidden])")!;
      expect(visible.querySelector("canvas")?.getAttribute("data-draft")).toBe(tabs[i % 2].id);
    }
    expect(mounts).toHaveBeenCalledTimes(2);
    expect(renders).toHaveBeenCalledTimes(2);
    expect(unmounts).not.toHaveBeenCalled();
    await act(() => root.render(<TabGroupContent tabs={[tabs[1]]} activeTab={tabs[1]} />));
    expect(unmounts).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
