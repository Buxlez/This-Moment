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

    const adjustButton = screen.getByRole("button", {name: "调整环境"});
    const editorId = adjustButton.getAttribute("aria-controls");
    expect(editorId).toBeTruthy();
    expect(adjustButton).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(editorId!)).not.toBeInTheDocument();

    await user.click(adjustButton);

    expect(adjustButton).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(editorId!)).toBeInTheDocument();

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

    fireEvent.change(screen.getByRole("textbox", {name: "当地时间"}), {
      target: {value: "2026-08-24T21:00"},
    });
    expect(onEnvironmentChange).toHaveBeenLastCalledWith({
      ...bootstrapFixture.environment,
      localTime: "2026-08-24T21:00",
      source: "manual",
    });
  });
});
