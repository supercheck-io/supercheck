import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { FormInput } from "./form-input";

describe("FormInput maxLength", () => {
  it("passes maxLength to the input so the browser stops typing at the limit", () => {
    render(<FormInput label="Name" id="name" maxLength={5} />);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input).toHaveAttribute("maxlength", "5");
  });

  it("shows the live count for an uncontrolled input when showCharacterCount is set", () => {
    render(<FormInput label="Name" id="name" maxLength={10} showCharacterCount />);
    expect(screen.getByText("0/10")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "abc" } });
    expect(screen.getByText("3/10")).toBeInTheDocument();
  });

  it("starts the count from defaultValue", () => {
    render(<FormInput label="Name" id="name" maxLength={10} showCharacterCount defaultValue="abc" />);
    expect(screen.getByText("3/10")).toBeInTheDocument();
  });

  it("follows the value of a controlled input", () => {
    function Controlled() {
      const [value, setValue] = useState("hello");
      return (
        <>
          <FormInput label="Name" id="name" maxLength={10} showCharacterCount value={value} onChange={(e) => setValue(e.target.value)} />
          <button onClick={() => setValue("")}>Clear</button>
        </>
      );
    }
    render(<Controlled />);
    expect(screen.getByText("5/10")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByText("0/10")).toBeInTheDocument();
  });

  it("does not render a count without maxLength", () => {
    render(<FormInput label="Name" id="name" showCharacterCount />);
    expect(screen.queryByText(/\/\d+/)).not.toBeInTheDocument();
  });
});
