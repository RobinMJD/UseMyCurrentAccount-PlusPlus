import { describe, expect, test, vi } from "vitest";
import { createRuntimeStateScheduler } from "../src/lib/runtimeStateScheduler";

describe("runtime state scheduler", () => {
  test("serializes applications and loads the latest state when each queued task starts", async () => {
    let currentState = 1;
    let releaseFirst: (() => void) | undefined;
    const firstApplyGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: number[] = [];
    const finished: number[] = [];
    const loadState = vi.fn(async () => currentState);
    const applyState = vi.fn(async (state: number) => {
      started.push(state);
      if (state === 1) {
        await firstApplyGate;
      }
      finished.push(state);
    });
    const schedule = createRuntimeStateScheduler(loadState, applyState);

    const first = schedule();
    await vi.waitFor(() => expect(started).toEqual([1]));

    currentState = 2;
    const second = schedule();
    currentState = 3;
    await Promise.resolve();
    expect(started).toEqual([1]);

    releaseFirst?.();
    await Promise.all([first, second]);

    expect(started).toEqual([1, 3]);
    expect(finished).toEqual([1, 3]);
    expect(loadState).toHaveBeenCalledTimes(2);
  });

  test("continues processing after an earlier application fails", async () => {
    let currentState = 1;
    const applyState = vi.fn(async (state: number) => {
      if (state === 1) {
        throw new Error("first update failed");
      }
    });
    const schedule = createRuntimeStateScheduler(async () => currentState, applyState);

    await expect(schedule()).rejects.toThrow("first update failed");
    currentState = 2;
    await expect(schedule()).resolves.toBeUndefined();
    expect(applyState).toHaveBeenCalledTimes(2);
  });
});
