/**
 * The groups screen carries every supervision action and had no tests while the
 * backend had 28. These pin what breaks silently: the roster, the progress
 * column's two distinct "no data" meanings, the reminder flow, and the
 * admin-only surfaces.
 *
 * Note on queries: a username appears in the roster, the weekly table and the
 * member picker, so assertions use `findAllBy*` rather than `findBy*`.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GroupsPage from "@/app/(utility)/groups/page";

const mocks = vi.hoisted(() => ({
  listGroups: vi.fn(),
  getGroupReport: vi.fn(),
  getGroupGrantable: vi.fn(),
  getWeeklyReport: vi.fn(),
  listAdminUsers: vi.fn(),
  remindMembers: vi.fn(),
  setGroupMembers: vi.fn(),
  isAdmin: true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars
        ? key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name]))
        : key,
  }),
}));

vi.mock("@/hooks/useAuthStatus", () => ({
  useAuthStatus: () => ({ isAdmin: mocks.isAdmin }),
}));

vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn(async () => undefined) }));

vi.mock("@/lib/group-api", () => ({
  listGroups: mocks.listGroups,
  getGroupReport: mocks.getGroupReport,
  getGroupGrantable: mocks.getGroupGrantable,
  getWeeklyReport: mocks.getWeeklyReport,
  listAdminUsers: mocks.listAdminUsers,
  remindMembers: mocks.remindMembers,
  setGroupMembers: mocks.setGroupMembers,
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
  createGroupMember: vi.fn(),
  removeGroupMember: vi.fn(),
  resetGroupMemberPassword: vi.fn(),
  getGroupMemberGrants: vi.fn(),
  setGroupMemberGrants: vi.fn(),
}));

const GROUP = {
  id: "g1",
  name: "Cohort",
  lead_user_id: "u-lead",
  member_user_ids: ["u-m1"],
  created_at: "2026-11-01T00:00:00Z",
  created_by: "admin",
  updated_at: "2026-11-01T00:00:00Z",
  lead: { id: "u-lead", username: "lead" },
  members: [{ id: "u-m1", username: "member1" }],
};

const REPORT = {
  group: GROUP,
  members: [
    {
      user_id: "u-lead",
      username: "lead",
      role: "user",
      preset: "standard",
      disabled: false,
      must_change_password: false,
      last_active_at: "2026-11-03T00:00:00Z",
      learning: { paths: 3, knowledge_points: 12, mastery_pct: 60 },
      last_reminded_at: null,
      grant_summary: { model_count: 1, knowledge_base_count: 0, skill_count: 0 },
    },
    {
      user_id: "u-m1",
      username: "member1",
      role: "user",
      preset: "standard",
      disabled: false,
      must_change_password: false,
      last_active_at: null,
      // A member whose scope could not be read reports null, not zeros.
      learning: null,
      last_reminded_at: "2026-11-03T00:00:00Z",
      grant_summary: { model_count: 0, knowledge_base_count: 0, skill_count: 0 },
    },
  ],
};

const WEEKLY = {
  group: GROUP,
  days: 7,
  members: [{ user_id: "u-m1", username: "member1", total_tokens: 1234, calls: 5 }],
  total_tokens: 1234,
};

beforeEach(() => {
  mocks.isAdmin = true;
  mocks.listGroups.mockResolvedValue([GROUP]);
  mocks.getGroupReport.mockResolvedValue(REPORT);
  mocks.getGroupGrantable.mockResolvedValue({ models: [], knowledge_bases: [], skills: [] });
  mocks.getWeeklyReport.mockResolvedValue(WEEKLY);
  mocks.listAdminUsers.mockResolvedValue([
    { id: "u-lead", username: "lead", role: "user" },
    { id: "u-m2", username: "newbie", role: "user" },
  ]);
  mocks.remindMembers.mockResolvedValue({ reminded: 1, at: "2026-11-04T00:00:00Z" });
  mocks.setGroupMembers.mockResolvedValue(GROUP);
});

describe("groups screen", () => {
  it("renders the roster with each member's mastery progress", async () => {
    render(<GroupsPage />);

    expect((await screen.findAllByText("member1")).length).toBeGreaterThan(0);
    expect(screen.getByText("3 paths · 60% mastery")).toBeInTheDocument();
    // The screen calls itself Teams: "群组" belongs to the Partner Groups feature.
    expect(screen.getByText("Teams")).toBeInTheDocument();
  });

  it("shows an unreadable scope as a dash instead of a zero", async () => {
    render(<GroupsPage />);

    await screen.findAllByText("member1");
    // member1 has learning: null — the page must not print "0 paths".
    expect(screen.queryByText("0 paths · 0% mastery")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("reminds everyone who has been inactive this week", async () => {
    render(<GroupsPage />);

    await screen.findAllByText("member1");
    fireEvent.click(screen.getByRole("button", { name: "Remind inactive" }));

    await waitFor(() => expect(mocks.remindMembers).toHaveBeenCalledTimes(1));
    expect(mocks.remindMembers).toHaveBeenCalledWith("g1", ["member1"]);
  });

  it("lets an admin change the roster with existing accounts", async () => {
    render(<GroupsPage />);

    await screen.findByText("Manage members");
    fireEvent.click(screen.getByRole("button", { name: "Edit roster" }));

    // Two checkboxes carry this name: the create-group form at the top and the
    // roster picker below it. The picker is the later one in the DOM.
    const boxes = await screen.findAllByRole("checkbox", { name: "newbie" });
    fireEvent.click(boxes[boxes.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: "Save members" }));

    await waitFor(() => expect(mocks.setGroupMembers).toHaveBeenCalledTimes(1));
    const [groupId, ids] = mocks.setGroupMembers.mock.calls[0];
    expect(groupId).toBe("g1");
    expect(ids).toContain("u-m2");
  });

  it("hides the admin-only surfaces from a group lead", async () => {
    mocks.isAdmin = false;
    render(<GroupsPage />);

    await screen.findAllByText("member1");
    expect(screen.queryByText("Manage members")).not.toBeInTheDocument();
    expect(screen.queryByText("Create team")).not.toBeInTheDocument();
    // The lead still sees the roster and the weekly usage they are entitled to.
    expect(screen.getByText(/Weekly usage/)).toBeInTheDocument();
  });

  it("offers the weekly numbers for export", async () => {
    render(<GroupsPage />);

    await screen.findByText("Export CSV");
    const weeklyCard = screen.getByText(/Weekly usage/).closest("div");
    expect(weeklyCard).not.toBeNull();
    if (weeklyCard) {
      expect(within(weeklyCard).getByRole("button", { name: "Copy as Markdown" })).toBeInTheDocument();
    }
  });
});
