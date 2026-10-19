import { fireEvent, render, screen } from "@testing-library/react";

import { InfoHint, InfoHintText } from "./info-hint";

describe("InfoHint", () => {
  it("keeps supporting copy out of the layout until the info button is used", () => {
    render(
      <InfoHint label="Domain setup details">
        <InfoHintText>Point a CNAME at the status page target.</InfoHintText>
      </InfoHint>,
    );

    expect(screen.queryByText(/Point a CNAME/)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Domain setup details" }),
    );

    expect(screen.getByText(/Point a CNAME/)).toBeInTheDocument();
  });

  it("does not submit the surrounding form", () => {
    const onSubmit = jest.fn((event: React.FormEvent) => {
      event.preventDefault();
    });

    render(
      <form onSubmit={onSubmit}>
        <InfoHint label="Contact options">
          <InfoHintText>Email or support URL.</InfoHintText>
        </InfoHint>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Contact options" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
