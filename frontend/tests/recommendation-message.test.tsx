import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";
import {RecommendationMessage} from "../src/components/RecommendationMessage";
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

  it("uses narration-state labels and disables in-progress actions", () => {
    const {container, rerender} = render(
      <RecommendationMessage
        card={{...demoCard, ttsStatus: "failed"}}
        onPlayTrack={vi.fn()}
        onNarrationAction={vi.fn()}
      />,
    );

    expect(within(container).getByRole("button", {name: "重试推荐语"})).toBeEnabled();

    rerender(
      <RecommendationMessage
        card={{...demoCard, ttsStatus: "playing"}}
        onPlayTrack={vi.fn()}
        onNarrationAction={vi.fn()}
      />,
    );
    expect(
      within(container).getByRole("button", {name: "正在播放推荐语"}),
    ).toBeDisabled();

    rerender(
      <RecommendationMessage
        card={{...demoCard, ttsStatus: "pending"}}
        onPlayTrack={vi.fn()}
        onNarrationAction={vi.fn()}
      />,
    );
    expect(within(container).getByRole("button", {name: "播放推荐语"})).toBeDisabled();
  });
});
