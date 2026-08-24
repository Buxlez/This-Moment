import {useId, useState} from "react";
import {Button} from "@astryxdesign/core/Button";
import {Heading} from "@astryxdesign/core/Heading";
import {HStack} from "@astryxdesign/core/HStack";
import {LayoutHeader} from "@astryxdesign/core/Layout";
import {Section} from "@astryxdesign/core/Section";
import {Selector} from "@astryxdesign/core/Selector";
import {StatusDot} from "@astryxdesign/core/StatusDot";
import {Text} from "@astryxdesign/core/Text";
import {TextInput} from "@astryxdesign/core/TextInput";
import {VStack} from "@astryxdesign/core/VStack";
import type {EnvironmentState, ServiceState} from "../domain/models";

interface EnvironmentHeaderProps {
  service: ServiceState;
  environment: EnvironmentState;
  onEnvironmentChange: (environment: EnvironmentState) => void;
}

const weatherOptions = ["晴朗", "多云", "下雨", "高温", "寒冷", "雪天"];

export function EnvironmentHeader({
  service,
  environment,
  onEnvironmentChange,
}: EnvironmentHeaderProps) {
  const editorId = useId();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const statusVariant =
    service.status === "connected"
      ? "success"
      : service.status === "reconnecting"
        ? "warning"
        : "error";

  return (
    <LayoutHeader hasDivider role="banner">
      <VStack gap={3}>
        <HStack align="center" gap={3} justify="between" wrap="wrap">
          <VStack gap={0.5}>
            <Heading level={1}>this moment</Heading>
            <Text type="supporting">AI MUSIC EDITOR</Text>
          </VStack>

          <HStack align="center" gap={2} wrap="wrap">
            <HStack align="center" gap={1}>
              <StatusDot
                isPulsing={service.status === "reconnecting"}
                label={service.label}
                variant={statusVariant}
              />
              <Text type="supporting">{service.label}</Text>
            </HStack>
            <Text>
              {environment.city} · {environment.weather} · {environment.temperatureC}°
            </Text>
            <Button
              aria-controls={editorId}
              aria-expanded={isEditorOpen}
              label="调整环境"
              onClick={() => setIsEditorOpen((isOpen) => !isOpen)}
              variant="ghost"
            />
          </HStack>
        </HStack>

        {isEditorOpen ? (
          <Section id={editorId} padding={4} variant="muted">
            <HStack align="end" gap={3} wrap="wrap">
              <TextInput
                label="城市"
                onChange={(city) =>
                  onEnvironmentChange({...environment, city, source: "manual"})
                }
                value={environment.city}
              />
              <Selector
                label="天气"
                onChange={(weather) =>
                  onEnvironmentChange({...environment, weather, source: "manual"})
                }
                options={weatherOptions}
                value={environment.weather}
              />
              <TextInput
                label="当地时间"
                onChange={(localTime) =>
                  onEnvironmentChange({...environment, localTime, source: "manual"})
                }
                value={environment.localTime}
              />
            </HStack>
          </Section>
        ) : null}
      </VStack>
    </LayoutHeader>
  );
}
