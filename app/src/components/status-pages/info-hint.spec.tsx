import { fireEvent, render, screen } from "@testing-library/react";

import { InfoHint, InfoHintText } from "./info-hint";

describe("InfoHint", () => {
  it("keeps supporting copy out of the layout until the info button is used", () => {
    render(
      <InfoHint label="Domain setup details" title="Domain setup">
        <InfoHintText>Point a CNAME at the status page target.</InfoHintText>
      </InfoHint>,
    );

    expect(screen.queryByText(/Point a CNAME/)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Domain setup details" }),
    );

    expect(screen.getByText(/Point a CNAME/)).toBeInTheDocument();
  });

  it("shows the title alone in the panel header, with no second info icon", () => {
    render(
      <InfoHint label="Internal name details" title="Internal name">
        <InfoHintText>Visitors see the headline instead.</InfoHintText>
      </InfoHint>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Internal name details" }));

    const panel = screen.getByRole("dialog", { name: "Internal name details" });
    expect(panel).toHaveTextContent("Internal name");
    expect(panel.querySelector("svg")).toBeNull();
  });

  it("does not submit the surrounding form", () => {
    const onSubmit = jest.fn((event: React.FormEvent) => {
      event.preventDefault();
    });

    render(
      <form onSubmit={onSubmit}>
        <InfoHint label="Contact options" title="Contact options">
          <InfoHintText>Email or support URL.</InfoHintText>
        </InfoHint>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Contact options" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
