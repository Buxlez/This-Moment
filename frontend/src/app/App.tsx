import {InternationalizationProvider} from "@astryxdesign/core/i18n";
import zhCN from "@astryxdesign/core/locales/zh-CN.json";
import {Theme} from "@astryxdesign/core/theme";
import {neutralTheme} from "@astryxdesign/theme-neutral/built";
import {MockExperiencePage} from "../components/MockExperiencePage";
import {MockRecommendationGateway} from "../gateways/MockRecommendationGateway";
import type {RecommendationGateway} from "../gateways/RecommendationGateway";

export interface AppProps {
  gateway?: RecommendationGateway;
}

const defaultGateway = new MockRecommendationGateway();

export function App({gateway = defaultGateway}: AppProps) {
  return (
    <InternationalizationProvider locale="zh-CN" messages={{"zh-CN": zhCN}}>
      <Theme theme={neutralTheme} mode="system">
        <MockExperiencePage gateway={gateway} />
      </Theme>
    </InternationalizationProvider>
  );
}
