import { fireEvent, render, screen } from "@testing-library/react";
import { AuthCallout, InviteBanner, PasswordToggle } from "./auth-shell";

describe("auth shell", () => {
  it("announces errors as alerts and other callouts as status", () => {
    render(
      <>
        <AuthCallout variant="error">Bad password</AuthCallout>
        <AuthCallout variant="success">Sent</AuthCallout>
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Bad password");
    expect(screen.getByRole("status")).toHaveTextContent("Sent");
  });

  it("toggles password visibility with a labelled button", () => {
    const onToggle = jest.fn();
    render(<PasswordToggle shown={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("formats the invited role and defaults to member", () => {
    const { rerender } = render(<InviteBanner organizationName="Acme" role="project_editor" email="a@example.test" />);
    expect(screen.getByText("Project Editor")).toBeInTheDocument();
    expect(screen.getByText("a@example.test")).toBeInTheDocument();
    rerender(<InviteBanner organizationName="Acme" />);
    expect(screen.getByText("Member")).toBeInTheDocument();
  });
});
