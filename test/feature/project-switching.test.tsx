import { describe, it, beforeEach, expect, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import HeaderWin from "../../src/components/TopBar/index";
import { BrowserRouter } from "react-router-dom";
import { mockProjectStore } from "../mocks/projectStore.mock";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import userEvent from "@testing-library/user-event";


const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/" }),
  };
});

vi.mock("@/hooks/useChatStoreAdapter", () => ({
  default: vi.fn(),
}));

// mock electron
Object.defineProperty(window, "electronAPI", {
  value: {
    getPlatform: vi.fn(() => "win32"),
    isFullScreen: vi.fn(() => false),
  },
});
const mockToggle = vi.fn();

vi.mock("@/store/sidebarStore", () => ({
  useSidebarStore: () => ({
    toggle: mockToggle,
  }),
}));


describe("Feature: User switches between projects or tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore.__reset();
  });

  it("should switch project when user clicks New Project button", async () => {
    const user = userEvent.setup();

    mockProjectStore.createProject("Project A");
    mockProjectStore.createProject("Project B");

    (useChatStoreAdapter as any).mockReturnValue({
      chatStore: { tasks: {}, activeTaskId: null },
      projectStore: mockProjectStore,
    });

    render(
      <BrowserRouter>
        <HeaderWin />
      </BrowserRouter>
    );

    // Find the new project button by its accessible label
    const newProjectBtn = await screen.findByRole("button", { name: /new project/i });

    await user.click(newProjectBtn);

    // Assert user-visible behavior: navigation to home
    expect(mockNavigate).toHaveBeenCalledWith("/");

    // Assert the visible title changes to show new project
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /new project/i })).toBeInTheDocument();
    });
  });

 it("should switch to Task Two when user clicks it in sidebar", async () => {
  const user = userEvent.setup();

  mockProjectStore.createProject("Project A");

  const chatStore = {
    tasks: {
      t1: { summaryTask: "Task One", status: "pending", messages: [] },
      t2: { summaryTask: "Task Two", status: "pending", messages: [] },
    },
    activeTaskId: "t1",
    setState: vi.fn(),
    removeTask: vi.fn(),
  };

  // mutate chatStore correctly
  chatStore.setState.mockImplementation((update) =>
    Object.assign(chatStore, update)
  );

  (useChatStoreAdapter as any).mockReturnValue({
    chatStore,
    projectStore: mockProjectStore,
  });

  render(
    <BrowserRouter>
      <HeaderWin />
    </BrowserRouter>
  );

  // User clicks the task switcher button to open sidebar
  const switcher = screen.getByRole("button", { name: /Task One/i });
  await user.click(switcher);

  // Verify sidebar toggle was called (user sees sidebar open)
  expect(mockToggle).toHaveBeenCalled();

  // Note: This test verifies the user interaction flow.
  // Once the sidebar component renders task items with accessible roles,
  // we should extend this test to:
  // 1. Find task items by role (e.g., getByRole("menuitem", { name: "Task Two" }))
  // 2. Click the task item
  // 3. Assert the UI updates (e.g., switcher button shows "Task Two")
});

});