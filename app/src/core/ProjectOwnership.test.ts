import { invoke, isTauri } from "@tauri-apps/api/core";
import { Dialog } from "@/components/ui/dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadWithProjectOwnership, ProjectOwnershipError } from "./ProjectOwnership";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@/core/OpenProjectRuntimeHost", () => ({
  ensureOpenProjectRuntimeBridgeListener: vi.fn(async () => undefined),
}));
vi.mock("@/components/ui/dialog", () => ({ Dialog: { buttons: vi.fn(async () => "retry") } }));
vi.mock("i18next", () => ({
  default: {
    t: vi.fn((key: string) => {
      const messages: Record<string, string> = {
        "projectOwnership.notFound": "项目文件不存在。",
        "projectOwnership.busy": "该项目正在被另一个 Project Graph 进程使用。",
        "projectOwnership.loadFailed": "无法取得项目所有权。",
      };
      return messages[key] ?? key;
    }),
  },
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);

describe("desktop Project ownership lifecycle", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReturnValue(true);
    vi.mocked(Dialog.buttons).mockClear();
  });

  it("acquires before loading and releases when initialization fails", async () => {
    invokeMock
      .mockResolvedValueOnce({
        status: "acquired",
        ownershipId: "desktop-123-1",
        canonicalPath: "/projects/graph.prg",
      })
      .mockResolvedValue(undefined);
    const load = vi.fn(async () => {
      throw new Error("initialization failed");
    });

    await expect(loadWithProjectOwnership("/projects/graph.prg", load)).rejects.toThrow("initialization failed");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "acquire_desktop_project_ownership", {
      projectPath: "/projects/graph.prg",
    });
    expect(load).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenNthCalledWith(2, "release_desktop_project_ownership", {
      ownershipId: "desktop-123-1",
    });
  });

  it("keeps retrying a visible release after pre-Project initialization fails", async () => {
    invokeMock
      .mockResolvedValueOnce({
        status: "acquired",
        ownershipId: "desktop-123-1",
        canonicalPath: "/projects/graph.prg",
      })
      .mockRejectedValueOnce({ code: "PROJECT_LOAD_FAILED" })
      .mockResolvedValueOnce(undefined);
    const initializationError = new Error("initialization failed");

    await expect(
      loadWithProjectOwnership("/projects/graph.prg", async () => {
        throw initializationError;
      }),
    ).rejects.toBe(initializationError);

    expect(Dialog.buttons).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenNthCalledWith(3, "release_desktop_project_ownership", {
      ownershipId: "desktop-123-1",
    });
  });

  it("holds ownership after loading until the live Project disposes its lease", async () => {
    invokeMock
      .mockResolvedValueOnce({
        status: "acquired",
        ownershipId: "desktop-123-1",
        canonicalPath: "/projects/graph.prg",
      })
      .mockResolvedValue(undefined);

    const result = await loadWithProjectOwnership("/projects/graph.prg", async (ownership) => ownership);

    expect(result.status).toBe("opened");
    if (result.status !== "opened") throw new Error("expected an opened Project");
    expect(result.value?.ownershipId).toBe("desktop-123-1");
    expect(result.value?.canonicalPath).toBe("/projects/graph.prg");
    expect(invokeMock).toHaveBeenCalledOnce();

    await result.value?.dispose();
    await result.value?.dispose();

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("release_desktop_project_ownership", {
      ownershipId: "desktop-123-1",
    });
  });

  it("returns the existing canonical owner without loading a second Project", async () => {
    invokeMock.mockResolvedValueOnce({
      status: "already_owned",
      ownershipId: "desktop-123-1",
      canonicalPath: "/projects/graph.prg",
    });
    const load = vi.fn();

    await expect(loadWithProjectOwnership("/projects/graph-link.prg", load)).resolves.toEqual({
      status: "already_open",
      ownershipId: "desktop-123-1",
      canonicalPath: "/projects/graph.prg",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("reclaims its own lease after a WebView reload without claiming it twice in the current document", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    const acquisition = { status: "already_owned", ownershipId: "desktop-321-4", canonicalPath: "/projects/check.prg" };
    storage.set(
      "pg:desktop-lease:desktop-321-4",
      JSON.stringify({ path: acquisition.canonicalPath, document: performance.timeOrigin - 1000 }),
    );
    try {
      invokeMock.mockResolvedValue(acquisition);
      const reopened = await loadWithProjectOwnership(acquisition.canonicalPath, async (lease) => lease);
      if (reopened.status !== "opened") throw Error("expected to reopen");
      const duplicate = await loadWithProjectOwnership(acquisition.canonicalPath, vi.fn());
      expect(duplicate.status).toBe("already_open");
      await reopened.value?.dispose();
      expect(storage.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("normalizes release failures for the Project user-visible error boundary", async () => {
    invokeMock
      .mockResolvedValueOnce({
        status: "acquired",
        ownershipId: "desktop-123-1",
        canonicalPath: "/projects/graph.prg",
      })
      .mockRejectedValueOnce({ code: "PROJECT_LOAD_FAILED" });
    const result = await loadWithProjectOwnership("/projects/graph.prg", async (ownership) => ownership);

    if (result.status !== "opened") throw new Error("expected an opened Project");

    await expect(result.value?.dispose()).rejects.toMatchObject({
      name: "ProjectOwnershipError",
      code: "PROJECT_LOAD_FAILED",
      message: "无法取得项目所有权。",
    });

    invokeMock.mockResolvedValueOnce(undefined);
    await expect(result.value?.dispose()).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenLastCalledWith("release_desktop_project_ownership", {
      ownershipId: "desktop-123-1",
    });
  });

  it("normalizes ownership contention into the stable user-facing error", async () => {
    invokeMock.mockRejectedValueOnce({
      code: "PROJECT_BUSY",
      owner: { kind: "connectable", endpoint: "ipc://runtime-host" },
    });

    const result = loadWithProjectOwnership("/projects/graph.prg", vi.fn());

    await expect(result).rejects.toBeInstanceOf(ProjectOwnershipError);
    await expect(result).rejects.toMatchObject({
      name: "ProjectOwnershipError",
      code: "PROJECT_BUSY",
      message: "该项目正在被另一个 Project Graph 进程使用。",
      owner: { kind: "connectable", endpoint: "ipc://runtime-host" },
    });
  });

  it("keeps the web Project loading path unchanged", async () => {
    isTauriMock.mockReturnValue(false);
    const load = vi.fn(async (ownership) => ownership ?? "web-project");

    await expect(loadWithProjectOwnership("/projects/graph.prg", load)).resolves.toEqual({
      status: "opened",
      value: "web-project",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
