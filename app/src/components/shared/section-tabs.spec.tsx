import { fireEvent, render, screen } from "@testing-library/react";
import { Users, FolderOpen } from "lucide-react";

import { Tabs } from "@/components/ui/tabs";
import { SectionTabs } from "./section-tabs";

const tabs = [
  { value: "projects", label: "Projects", icon: FolderOpen },
  { value: "members", label: "Members", icon: Users },
];

it("renders a tab per section and reports changes", () => {
  const onValueChange = jest.fn();
  render(
    <Tabs value="projects" onValueChange={onValueChange}>
      <SectionTabs tabs={tabs} value="projects" onValueChange={onValueChange} />
    </Tabs>,
  );
  expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("data-state", "active");
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Members" }), { button: 0, ctrlKey: false });
  expect(onValueChange).toHaveBeenCalledWith("members");
});
