import {cleanup, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, it} from "vitest";
import {MockExperiencePage} from "../src/components/MockExperiencePage";
import {MockRecommendationGateway} from "../src/gateways/MockRecommendationGateway";

afterEach(cleanup);

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

  it("keeps narration ready while a song is actively playing", async () => {
    const user = userEvent.setup();

    render(<MockExperiencePage gateway={new MockRecommendationGateway(0)} />);

    expect(await screen.findByText("给回家路上的柔和夜色")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {name: "播放 Night Cruising"}),
    );
    await user.click(screen.getByRole("button", {name: "播放推荐语"}));

    expect(screen.getByRole("button", {name: "播放推荐语"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "暂停"})).toBeInTheDocument();
  });
});
