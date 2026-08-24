import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";
import {RecommendationMessage} from "../src/components/RecommendationMessage";
import type {TtsStatus} from "../src/domain/models";
import {demoCard} from "../src/gateways/fixtures";

describe("RecommendationMessage", () => {
  it("renders songs as list rows and exposes narration and play actions", async () => {
    const user = userEvent.setup();
    const onPlayTrack = vi.fn();
    const onNarrationAction = vi.fn();

    render(
      <RecommendationMessage
        card={demoCard}
        onPlayTrack={onPlayTrack}
        onNarrationAction={onNarrationAction}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    await user.click(screen.getByRole("button", {name: "播放 Night Cruising"}));
    await user.click(screen.getByRole("button", {name: "播放推荐语"}));

    expect(onPlayTrack).toHaveBeenCalledWith(demoCard.tracks[0], demoCard.tracks);
    expect(onNarrationAction).toHaveBeenCalledWith(demoCard.id);
  });

  it.each<{
    status: TtsStatus;
    statusLabel: string;
    actionLabel: string;
    isDisabled: boolean;
  }>([
    {
      status: "pending",
      statusLabel: "推荐语生成中",
      actionLabel: "推荐语生成中",
      isDisabled: true,
    },
    {
      status: "ready",
      statusLabel: "推荐语已就绪",
      actionLabel: "播放推荐语",
      isDisabled: false,
    },
    {
      status: "playing",
      statusLabel: "正在播放推荐语",
      actionLabel: "正在播放推荐语",
      isDisabled: true,
    },
    {
      status: "blocked",
      statusLabel: "推荐语等待点击播放",
      actionLabel: "点击播放推荐语",
      isDisabled: false,
    },
    {
      status: "failed",
      statusLabel: "推荐语生成失败",
      actionLabel: "重试推荐语",
      isDisabled: false,
    },
  ])(
    "presents $status narration state in Chinese",
    async ({status, statusLabel, actionLabel, isDisabled}) => {
      const user = userEvent.setup();
      const onNarrationAction = vi.fn();
      const {container} = render(
        <RecommendationMessage
          card={{...demoCard, ttsStatus: status}}
          onPlayTrack={vi.fn()}
          onNarrationAction={onNarrationAction}
        />,
      );

      expect(within(container).getByRole("img", {name: statusLabel})).toBeInTheDocument();
      expect(within(container).getAllByText(statusLabel).length).toBeGreaterThan(0);

      const action = within(container).getByRole("button", {name: actionLabel});
      expect(action).toHaveProperty("disabled", isDisabled);

      if (isDisabled) {
        await user.click(action);
        expect(onNarrationAction).not.toHaveBeenCalled();
      }
    },
  );
});
