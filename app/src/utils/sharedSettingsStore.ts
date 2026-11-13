import { invoke } from "@tauri-apps/api/core";

type Snapshot = { revision: string; values: Record<string, unknown> | null };
type Invoke = typeof invoke;

export class SharedSettingsStore {
  private values: Record<string, unknown> = {};
  private revision: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, number>();
  private sequence = 0;
  private changed?: (values: Record<string, unknown>) => void;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private path: string,
    private call: Invoke = invoke,
  ) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next;
    return next;
  }

  private accept(snapshot: Snapshot) {
    this.revision = snapshot.revision;
    if (!snapshot.values) return;
    const values = { ...snapshot.values };
    for (const key of this.pending.keys()) values[key] = this.values[key];
    this.values = values;
    this.changed?.(values);
  }

  async init() {
    await this.refresh();
  }
  async entries(): Promise<[string, unknown][]> {
    return Object.entries(this.values);
  }
  async save() {
    await this.queue;
  }

  set(key: string, value: unknown): Promise<void> {
    // Clone while called: later edits to a setting object must not alter an already queued write.
    value = structuredClone(value);
    const sequence = ++this.sequence;
    this.pending.set(key, sequence);
    this.values[key] = value;
    return this.enqueue(async () => {
      try {
        const snapshot = await this.call<Snapshot>("write_shared_setting", { path: this.path, key, value });
        if (this.pending.get(key) === sequence) this.pending.delete(key);
        this.accept(snapshot);
      } catch (error) {
        if (this.pending.get(key) === sequence) this.pending.delete(key);
        // Force the next read to restore the actual saved state after a failed write.
        this.revision = null;
        throw error;
      }
    });
  }

  refresh(): Promise<void> {
    return this.enqueue(async () => {
      this.accept(await this.call<Snapshot>("read_shared_settings", { path: this.path, revision: this.revision }));
    });
  }

  start(changed: (values: Record<string, unknown>) => void, reportError: (error: unknown) => void) {
    this.changed = changed;
    changed(this.values);
    let reportedFailure = false;
    const refresh = async () => {
      try {
        await this.refresh();
        reportedFailure = false;
      } catch (error) {
        if (!reportedFailure) reportError(error);
        reportedFailure = true;
      }
    };
    const poll = async () => {
      await refresh();
      if (!this.stopped) this.timer = setTimeout(poll, 750);
    };
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    this.timer = setTimeout(poll, 750);
    return () => {
      this.stopped = true;
      clearTimeout(this.timer);
      window.removeEventListener("focus", onFocus);
      this.changed = undefined;
    };
  }
}
