import {fireEvent, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";
import {EnvironmentHeader} from "../src/components/EnvironmentHeader";
import {bootstrapFixture} from "../src/gateways/fixtures";

describe("EnvironmentHeader", () => {
  it("shows status and reveals editable environment fields", async () => {
    const user = userEvent.setup();

    const onEnvironmentChange = vi.fn();
    render(
      <EnvironmentHeader
        service={bootstrapFixture.service}
        environment={bootstrapFixture.environment}
        onEnvironmentChange={onEnvironmentChange}
      />,
    );

    expect(screen.getByText("Mock 已连接")).toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "调整环境"}));

    expect(screen.getByRole("textbox", {name: "城市"})).toHaveValue("上海");
    expect(screen.getByRole("combobox", {name: "天气"})).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", {name: "城市"}), {
      target: {value: "北京"},
    });
    expect(onEnvironmentChange).toHaveBeenLastCalledWith({
      ...bootstrapFixture.environment,
      city: "北京",
      source: "manual",
    });
  });
});
