import {StrictMode} from "react";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, it, vi} from "vitest";
import {MockExperiencePage} from "../src/components/MockExperiencePage";
import type {
  BootstrapData,
  RecommendationCard,
  TtsStatus,
} from "../src/domain/models";
import {MockRecommendationGateway} from "../src/gateways/MockRecommendationGateway";
import type {RecommendationGateway} from "../src/gateways/RecommendationGateway";
import {bootstrapFixture, demoCard} from "../src/gateways/fixtures";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {promise, resolve, reject};
}

class DeferredGateway implements RecommendationGateway {
  readonly bootstraps: Deferred<BootstrapData>[] = [];
  readonly generations: Array<Deferred<RecommendationCard> & {prompt: string}> = [];
  readonly retries: Array<
    Deferred<{cardId: string; status: "ready"}> & {cardId: string}
  > = [];

  bootstrap(): Promise<BootstrapData> {
    const request = deferred<BootstrapData>();
    this.bootstraps.push(request);
    return request.promise;
  }

  generate(prompt: string): Promise<RecommendationCard> {
    const request = {...deferred<RecommendationCard>(), prompt};
    this.generations.push(request);
    return request.promise;
  }

  retryNarration(cardId: string): Promise<{cardId: string; status: "ready"}> {
    const request = {
      ...deferred<{cardId: string; status: "ready"}>(),
      cardId,
    };
    this.retries.push(request);
    return request.promise;
  }
}

function bootstrapData(
  id = "card-bootstrap",
  headline = "给回家路上的柔和夜色",
  ttsStatus: TtsStatus = "ready",
): BootstrapData {
  return {
    service: {...bootstrapFixture.service},
    environment: {...bootstrapFixture.environment},
    cards: [
      {
        ...demoCard,
        id,
        headline,
        ttsStatus,
        tracks: demoCard.tracks.map((track) => ({...track})),
      },
    ],
  };
}

function generatedCard(
  id: string,
  headline: string,
  prompt = "夜里开车",
): RecommendationCard {
  return {
    ...demoCard,
    id,
    headline,
    prompt,
    tracks: demoCard.tracks.map((track) => ({...track})),
  };
}

async function resolveBootstrap(
  gateway: DeferredGateway,
  data = bootstrapData(),
  requestIndex = gateway.bootstraps.length - 1,
) {
  await act(async () => {
    gateway.bootstraps[requestIndex].resolve(data);
    await gateway.bootstraps[requestIndex].promise;
  });
}

function submitComposer(text: string) {
  const composer = screen.getByLabelText("音乐需求");
  composer.textContent = text;
  fireEvent.input(composer);
  fireEvent.keyDown(composer, {key: "Enter", code: "Enter"});
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MockExperiencePage", () => {
  it("bootstraps recommendations, generates a new set, and starts a selected song", async () => {
    const user = userEvent.setup();

    render(<MockExperiencePage gateway={new MockRecommendationGateway(0)} />);

    expect(await screen.findByText("给回家路上的柔和夜色")).toBeInTheDocument();

    const composer = screen.getByLabelText("音乐需求");
    await user.type(composer, "夜里开车，想听安静但不困的歌{Enter}");

    expect(await screen.findByText("为此刻重新排好的一组歌")).toBeInTheDocument();

    const playButtons = screen.getAllByRole("button", {
      name: "播放 Night Cruising",
    });
    await user.click(playButtons.at(-1)!);

    expect(
      screen.getByRole("region", {name: "歌曲播放器"}),
    ).toBeInTheDocument();
  });

  it("blocks submission until bootstrap settles", async () => {
    const gateway = new DeferredGateway();
    render(<MockExperiencePage gateway={gateway} />);

    expect(screen.getByLabelText("音乐需求")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    submitComposer("不应提前发送");
    expect(gateway.generations).toHaveLength(0);

    await resolveBootstrap(gateway);
    expect(screen.getByLabelText("音乐需求")).toHaveAttribute(
      "contenteditable",
      "true",
    );
  });

  it("ignores obsolete bootstrap and generation results after gateway replacement", async () => {
    const first = new DeferredGateway();
    const second = new DeferredGateway();
    const {rerender} = render(<MockExperiencePage gateway={first} />);

    await resolveBootstrap(first, bootstrapData("card-first", "第一网关"));
    submitComposer("第一网关请求");
    expect(first.generations).toHaveLength(1);

    rerender(<MockExperiencePage gateway={second} />);
    await resolveBootstrap(second, bootstrapData("card-second", "第二网关"));
    submitComposer("第二网关请求");
    expect(second.generations).toHaveLength(1);

    await act(async () => {
      first.generations[0].resolve(
        generatedCard("generated-first", "过期生成结果"),
      );
      await first.generations[0].promise;
    });

    expect(screen.queryByText("过期生成结果")).not.toBeInTheDocument();
    expect(screen.getByText("正在为此刻重新编排推荐")).toBeInTheDocument();

    submitComposer("重复请求");
    expect(second.generations).toHaveLength(1);

    await act(async () => {
      second.generations[0].resolve(
        generatedCard("generated-second", "当前生成结果"),
      );
      await second.generations[0].promise;
    });
    expect(screen.getByText("当前生成结果")).toBeInTheDocument();
  });

  it("ignores a late bootstrap from a replaced gateway", async () => {
    const first = new DeferredGateway();
    const second = new DeferredGateway();
    const {rerender} = render(<MockExperiencePage gateway={first} />);

    rerender(<MockExperiencePage gateway={second} />);
    await resolveBootstrap(second, bootstrapData("current-card", "当前网关引导"));
    await resolveBootstrap(first, bootstrapData("obsolete-card", "过期网关引导"));

    expect(screen.getByText("当前网关引导")).toBeInTheDocument();
    expect(screen.queryByText("过期网关引导")).not.toBeInTheDocument();
  });

  it("ignores an obsolete bootstrap result in StrictMode", async () => {
    const gateway = new DeferredGateway();
    render(
      <StrictMode>
        <MockExperiencePage gateway={gateway} />
      </StrictMode>,
    );

    expect(gateway.bootstraps).toHaveLength(2);
    await resolveBootstrap(
      gateway,
      bootstrapData("strict-current", "当前 StrictMode 引导"),
      1,
    );
    await resolveBootstrap(
      gateway,
      bootstrapData("strict-obsolete", "过期 StrictMode 引导"),
      0,
    );

    expect(screen.getByText("当前 StrictMode 引导")).toBeInTheDocument();
    expect(screen.queryByText("过期 StrictMode 引导")).not.toBeInTheDocument();
  });

  it("keeps new retry state isolated from an old gateway retry", async () => {
    const first = new DeferredGateway();
    const second = new DeferredGateway();
    const {rerender} = render(<MockExperiencePage gateway={first} />);

    await resolveBootstrap(
      first,
      bootstrapData("shared-card", "第一网关失败推荐", "failed"),
    );
    fireEvent.click(screen.getByRole("button", {name: "重试推荐语"}));
    expect(first.retries).toHaveLength(1);

    rerender(<MockExperiencePage gateway={second} />);
    await resolveBootstrap(
      second,
      bootstrapData("shared-card", "第二网关失败推荐", "failed"),
    );

    await act(async () => {
      first.retries[0].resolve({cardId: "shared-card", status: "ready"});
      await first.retries[0].promise;
    });

    expect(screen.getByRole("button", {name: "重试推荐语"})).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {name: "播放推荐语"}),
    ).not.toBeInTheDocument();
  });

  it("restores failed narration when retry rejects", async () => {
    const gateway = new DeferredGateway();
    render(<MockExperiencePage gateway={gateway} />);
    await resolveBootstrap(
      gateway,
      bootstrapData("failed-card", "失败推荐", "failed"),
    );

    fireEvent.click(screen.getByRole("button", {name: "重试推荐语"}));
    expect(screen.getByRole("button", {name: "推荐语生成中"})).toBeDisabled();

    await act(async () => {
      gateway.retries[0].reject(new Error("retry failed"));
      await expect(gateway.retries[0].promise).rejects.toThrow("retry failed");
    });

    expect(screen.getByRole("button", {name: "重试推荐语"})).toBeInTheDocument();
  });

  it("accepts only one synchronous generation submission", async () => {
    const gateway = new DeferredGateway();
    render(<MockExperiencePage gateway={gateway} />);
    await resolveBootstrap(gateway);

    submitComposer("  第一次请求  ");
    submitComposer("第二次请求");

    expect(gateway.generations).toHaveLength(1);
    expect(gateway.generations[0].prompt).toBe("第一次请求");
  });

  it("lets blocked narration play and return to ready", async () => {
    vi.useFakeTimers();
    const gateway = new DeferredGateway();
    render(<MockExperiencePage gateway={gateway} />);
    await resolveBootstrap(
      gateway,
      bootstrapData("blocked-card", "等待播放推荐", "blocked"),
    );

    fireEvent.click(screen.getByRole("button", {name: "点击播放推荐语"}));
    expect(
      screen.getByRole("button", {name: "正在播放推荐语"}),
    ).toBeDisabled();

    act(() => vi.advanceTimersByTime(900));
    expect(screen.getByRole("button", {name: "播放推荐语"})).toBeInTheDocument();
  });

  it("stops active narration before starting a song", async () => {
    vi.useFakeTimers();
    const gateway = new DeferredGateway();
    render(<MockExperiencePage gateway={gateway} />);
    await resolveBootstrap(gateway);

    const timerBaseline = vi.getTimerCount();
    fireEvent.click(screen.getByRole("button", {name: "播放推荐语"}));
    expect(vi.getTimerCount()).toBe(timerBaseline + 1);
    expect(
      screen.getByRole("button", {name: "正在播放推荐语"}),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", {name: "播放 Night Cruising"}));

    expect(screen.getByRole("button", {name: "播放推荐语"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "暂停"})).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(timerBaseline);
  });

  it("keeps narration through passive player controls but stops it when resuming", async () => {
    vi.useFakeTimers();
    const gateway = new DeferredGateway();
    render(<MockExperiencePage gateway={gateway} />);
    await resolveBootstrap(gateway);

    fireEvent.click(screen.getByRole("button", {name: "播放 Night Cruising"}));
    fireEvent.click(screen.getByRole("button", {name: "暂停"}));
    const timerBaseline = vi.getTimerCount();
    fireEvent.click(screen.getByRole("button", {name: "播放推荐语"}));
    expect(vi.getTimerCount()).toBe(timerBaseline + 1);
    fireEvent.keyDown(screen.getByRole("slider", {name: "播放进度"}), {
      key: "ArrowRight",
    });
    fireEvent.keyDown(screen.getByRole("slider", {name: "音量"}), {
      key: "ArrowRight",
    });
    fireEvent.click(screen.getByRole("button", {name: "静音"}));

    expect(
      screen.getByRole("button", {name: "正在播放推荐语"}),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", {name: "播放"}));
    expect(screen.getByRole("button", {name: "播放推荐语"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "暂停"})).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(timerBaseline);
  });

  it("keeps narration ready while a song is actively playing", async () => {
    const gateway = new DeferredGateway();
    render(<MockExperiencePage gateway={gateway} />);
    await resolveBootstrap(gateway);

    fireEvent.click(screen.getByRole("button", {name: "播放 Night Cruising"}));
    fireEvent.click(screen.getByRole("button", {name: "播放推荐语"}));

    expect(screen.getByRole("button", {name: "播放推荐语"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "暂停"})).toBeInTheDocument();
  });

  it("clears the narration timer on unmount", async () => {
    vi.useFakeTimers();
    const gateway = new DeferredGateway();
    const {unmount} = render(<MockExperiencePage gateway={gateway} />);
    await resolveBootstrap(gateway);

    const timerBaseline = vi.getTimerCount();
    fireEvent.click(screen.getByRole("button", {name: "播放推荐语"}));
    expect(vi.getTimerCount()).toBe(timerBaseline + 1);

    unmount();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timerBaseline);
  });
});
