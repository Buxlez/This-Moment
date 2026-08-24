import {
  ChatComposer,
  ChatComposerInput,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatSystemMessage,
} from "@astryxdesign/core/Chat";
import {Layout, LayoutContent} from "@astryxdesign/core/Layout";
import {VStack} from "@astryxdesign/core/VStack";
import {useMockExperience} from "../features/experience/useMockExperience";
import type {RecommendationGateway} from "../gateways/RecommendationGateway";
import {EnvironmentHeader} from "./EnvironmentHeader";
import {PlayerDock} from "./PlayerDock";
import {RecommendationMessage} from "./RecommendationMessage";

interface MockExperiencePageProps {
  gateway: RecommendationGateway;
}

const composerPlaceholder = "说说此刻的场景、心情，或你想听的音乐";

export function MockExperiencePage({gateway}: MockExperiencePageProps) {
  const experience = useMockExperience(gateway);

  const composer = (
    <VStack gap={0}>
      {experience.player.currentTrack ? (
        <PlayerDock
          dispatch={experience.playerDispatch}
          state={experience.player}
        />
      ) : null}
      <ChatComposer
        density="spacious"
        input={
          <ChatComposerInput
            isDisabled={experience.session.isGenerating}
            label="音乐需求"
            onChange={experience.setComposerValue}
            onSubmit={experience.submit}
            placeholder={composerPlaceholder}
            value={experience.composerValue}
          />
        }
        isDisabled={experience.session.isGenerating}
        onChange={experience.setComposerValue}
        onSubmit={experience.submit}
        placeholder={composerPlaceholder}
        value={experience.composerValue}
      />
    </VStack>
  );

  return (
    <Layout
      content={
        <LayoutContent padding={0} role="main">
          <ChatLayout composer={composer} density="spacious">
            <ChatMessageList
              density="spacious"
              isStreaming={experience.session.isGenerating}>
              {experience.session.entries.map((entry) =>
                entry.kind === "user" ? (
                  <ChatMessage key={entry.id} name="你" sender="user">
                    <ChatMessageBubble>{entry.text}</ChatMessageBubble>
                  </ChatMessage>
                ) : (
                  <RecommendationMessage
                    card={entry.card}
                    key={entry.card.id}
                    onNarrationAction={experience.narrationAction}
                    onPlayTrack={experience.playTrack}
                  />
                ),
              )}
              {experience.session.isGenerating ? (
                <ChatSystemMessage>正在为此刻重新编排推荐</ChatSystemMessage>
              ) : null}
              {experience.session.error ? (
                <ChatSystemMessage>{experience.session.error}</ChatSystemMessage>
              ) : null}
            </ChatMessageList>
          </ChatLayout>
        </LayoutContent>
      }
      contentWidth={960}
      header={
        <EnvironmentHeader
          environment={experience.environment}
          onEnvironmentChange={experience.setEnvironment}
          service={experience.service}
        />
      }
      height="fill"
    />
  );
}
