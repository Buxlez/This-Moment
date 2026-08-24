import {Button} from "@astryxdesign/core/Button";
import {ChatMessage, ChatMessageBubble} from "@astryxdesign/core/Chat";
import {Heading} from "@astryxdesign/core/Heading";
import {HStack} from "@astryxdesign/core/HStack";
import {List, ListItem} from "@astryxdesign/core/List";
import {Section} from "@astryxdesign/core/Section";
import {
  StatusDot,
  type StatusDotVariant,
} from "@astryxdesign/core/StatusDot";
import {Text} from "@astryxdesign/core/Text";
import {Thumbnail} from "@astryxdesign/core/Thumbnail";
import {VStack} from "@astryxdesign/core/VStack";
import type {RecommendationCard, Track, TtsStatus} from "../domain/models";

interface RecommendationMessageProps {
  card: RecommendationCard;
  onPlayTrack: (track: Track, queue: Track[]) => void;
  onNarrationAction: (cardId: string) => void;
}

interface NarrationView {
  statusLabel: string;
  actionLabel: string;
  statusVariant: StatusDotVariant;
  isDisabled: boolean;
  isPulsing?: boolean;
}

const narrationViews: Record<TtsStatus, NarrationView> = {
  pending: {
    statusLabel: "推荐语生成中",
    actionLabel: "推荐语生成中",
    statusVariant: "warning",
    isDisabled: true,
    isPulsing: true,
  },
  ready: {
    statusLabel: "推荐语已就绪",
    actionLabel: "播放推荐语",
    statusVariant: "success",
    isDisabled: false,
  },
  playing: {
    statusLabel: "正在播放推荐语",
    actionLabel: "正在播放推荐语",
    statusVariant: "accent",
    isDisabled: true,
    isPulsing: true,
  },
  blocked: {
    statusLabel: "推荐语等待点击播放",
    actionLabel: "点击播放推荐语",
    statusVariant: "warning",
    isDisabled: false,
  },
  failed: {
    statusLabel: "推荐语生成失败",
    actionLabel: "重试推荐语",
    statusVariant: "error",
    isDisabled: false,
  },
};

function formatDuration(durationMs: number) {
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RecommendationMessage({
  card,
  onPlayTrack,
  onNarrationAction,
}: RecommendationMessageProps) {
  const narrationView = narrationViews[card.ttsStatus];

  return (
    <ChatMessage name="AI 音乐编辑" sender="assistant">
      <ChatMessageBubble variant="ghost" width="100%">
        <Section padding={4} variant="muted">
          <VStack gap={4}>
            <VStack gap={1}>
              <Heading level={2}>{card.headline}</Heading>
              <Text>{card.narration}</Text>
            </VStack>

            <HStack align="center" gap={2} wrap="wrap">
              <StatusDot
                isPulsing={narrationView.isPulsing}
                label={narrationView.statusLabel}
                variant={narrationView.statusVariant}
              />
              <Text type="supporting">{narrationView.statusLabel}</Text>
              <Button
                isDisabled={narrationView.isDisabled}
                label={narrationView.actionLabel}
                onClick={() => onNarrationAction(card.id)}
                size="sm"
                variant="secondary"
              />
            </HStack>

            <List
              density="balanced"
              hasDividers
              header={<Heading level={3}>为你选的歌</Heading>}>
              {card.tracks.map((track) => (
                <ListItem
                  key={track.id}
                  description={track.artist}
                  endContent={
                    <HStack align="center" gap={2}>
                      <Text hasTabularNumbers type="supporting">
                        {formatDuration(track.durationMs)}
                      </Text>
                      <Button
                        label={`播放 ${track.title}`}
                        onClick={() => onPlayTrack(track, card.tracks)}
                        size="sm"
                        variant="ghost"
                      />
                    </HStack>
                  }
                  label={track.title}
                  startContent={
                    <Thumbnail
                      alt={`${track.title} 封面`}
                      label={track.title}
                      src={track.coverUrl}
                    />
                  }
                />
              ))}
            </List>
          </VStack>
        </Section>
      </ChatMessageBubble>
    </ChatMessage>
  );
}
