import {fireEvent, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";
import {PlayerDock} from "../src/components/PlayerDock";
import {demoTracks} from "../src/gateways/fixtures";
import {initialPlayerState} from "../src/features/player/playerReducer";

describe("PlayerDock", () => {
  it("stays hidden without a song and exposes controls with a selected song", async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    const {rerender} = render(
      <PlayerDock state={initialPlayerState} dispatch={dispatch} />,
    );
    expect(screen.queryByLabelText("歌曲播放器")).not.toBeInTheDocument();

    rerender(
      <PlayerDock
        state={{
          ...initialPlayerState,
          currentTrack: demoTracks[0],
          queue: demoTracks,
          isPlaying: true,
        }}
        dispatch={dispatch}
      />,
    );

    expect(screen.getByLabelText("歌曲播放器")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "暂停"})).toBeInTheDocument();
    expect(screen.getByRole("slider", {name: "播放进度"})).toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "上一首"}));
    await user.click(screen.getByRole("button", {name: "暂停"}));
    await user.click(screen.getByRole("button", {name: "下一首"}));
    await user.click(screen.getByRole("button", {name: "静音"}));
    fireEvent.keyDown(screen.getByRole("slider", {name: "播放进度"}), {
      key: "ArrowRight",
    });
    fireEvent.keyDown(screen.getByRole("slider", {name: "音量"}), {
      key: "ArrowRight",
    });

    expect(dispatch).toHaveBeenCalledWith({type: "previous"});
    expect(dispatch).toHaveBeenCalledWith({type: "toggle"});
    expect(dispatch).toHaveBeenCalledWith({type: "next"});
    expect(dispatch).toHaveBeenCalledWith({type: "mute"});
    expect(dispatch).toHaveBeenCalledWith({type: "progress", value: 1});
    expect(dispatch).toHaveBeenCalledWith({type: "volume", value: 71});
  });
});
