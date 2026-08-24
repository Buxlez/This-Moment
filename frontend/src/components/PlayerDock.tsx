import type {Dispatch} from "react";
import {Button} from "@astryxdesign/core/Button";
import {HStack} from "@astryxdesign/core/HStack";
import {Section} from "@astryxdesign/core/Section";
import {Slider} from "@astryxdesign/core/Slider";
import {Text} from "@astryxdesign/core/Text";
import {Thumbnail} from "@astryxdesign/core/Thumbnail";
import {VStack} from "@astryxdesign/core/VStack";
import type {PlayerAction, PlayerState} from "../features/player/playerReducer";

interface PlayerDockProps {
  state: PlayerState;
  dispatch: Dispatch<PlayerAction>;
}

export function PlayerDock({state, dispatch}: PlayerDockProps) {
  if (!state.currentTrack) {
    return null;
  }

  const track = state.currentTrack;

  return (
    <Section
      aria-label="歌曲播放器"
      dividers={["top"]}
      padding={3}
      variant="section">
      <HStack align="center" gap={3} justify="between" wrap="wrap">
        <HStack align="center" gap={2}>
          <Thumbnail
            alt={`${track.title} 封面`}
            label={track.title}
            src={track.coverUrl}
          />
          <VStack gap={0.5}>
            <Text weight="semibold">{track.title}</Text>
            <Text type="supporting">{track.artist}</Text>
          </VStack>
        </HStack>

        <HStack align="center" gap={1}>
          <Button
            label="上一首"
            onClick={() => dispatch({type: "previous"})}
            size="sm"
            variant="ghost"
          />
          <Button
            label={state.isPlaying ? "暂停" : "播放"}
            onClick={() => dispatch({type: "toggle"})}
            size="sm"
            variant="primary"
          />
          <Button
            label="下一首"
            onClick={() => dispatch({type: "next"})}
            size="sm"
            variant="ghost"
          />
        </HStack>

        <Slider
          isLabelHidden
          label="播放进度"
          onChange={(value: number) => dispatch({type: "progress", value})}
          value={state.progress}
          valueDisplay="none"
          width="100%"
        />

        <HStack align="center" gap={2}>
          <Button
            label={state.isMuted ? "取消静音" : "静音"}
            onClick={() => dispatch({type: "mute"})}
            size="sm"
            variant="ghost"
          />
          <Slider
            isLabelHidden
            label="音量"
            onChange={(value: number) => dispatch({type: "volume", value})}
            value={state.isMuted ? 0 : state.volume}
            valueDisplay="none"
          />
        </HStack>
      </HStack>
    </Section>
  );
}
