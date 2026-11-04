"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, RefreshCw, Trash2, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStatus } from "@/hooks/useAuthStatus";
import { copyText } from "@/lib/clipboard";
import {
  createGroup,
  createGroupMember,
  deleteGroup,
  getGroupGrantable,
  getGroupMemberGrants,
  getGroupReport,
  getWeeklyReport,
  listAdminUsers,
  listGroups,
  remindMembers,
  removeGroupMember,
  resetGroupMemberPassword,
  setGroupMemberGrants,
  setGroupMembers,
  type AdminUserSummary,
  type GrantableResources,
  type Group,
  type GroupMemberGrant,
  type GroupReportEntry,
  type GroupWeeklyReport,
} from "@/lib/group-api";

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]";
const buttonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--background)]/60 disabled:opacity-50";
const primaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-50";
const cardClass =
  "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.floor((Date.now() - at) / 86400000);
}

/**
 * Roster screen for a group lead, plus the admin controls that create groups.
 *
 * Everything here is authorised server-side against `group.lead_user_id` or
 * `require_admin`; the client never sends a role. The report carries status and
 * progress only — no conversation content ever reaches this page.
 */
export default function GroupsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuthStatus();

  const [groups, setGroups] = useState<Group[]>([]);
  const [activeId, setActiveId] = useState("");
  const [group, setGroup] = useState<Group | null>(null);
  const [report, setReport] = useState<GroupReportEntry[]>([]);
  const [grantable, setGrantable] = useState<GrantableResources | null>(null);
  const [weekly, setWeekly] = useState<GroupWeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [passwordTarget, setPasswordTarget] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState("");

  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [kbs, setKbs] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);

  // Admin-only: group creation.
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftLead, setDraftLead] = useState("");
  const [draftMembers, setDraftMembers] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [memberDraft, setMemberDraft] = useState<string[] | null>(null);

  const loadGroup = useCallback(async (groupId: string) => {
    const [body, catalog, week] = await Promise.all([
      getGroupReport(groupId),
      getGroupGrantable(groupId),
      getWeeklyReport(groupId, 7),
    ]);
    setGroup(body.group);
    setReport(body.members);
    setGrantable(catalog);
    setWeekly(week);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const list = await listGroups();
        if (cancelled) return;
        setGroups(list);
        if (list.length > 0) {
          setActiveId(list[0].id);
          await loadGroup(list[0].id);
        }
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadGroup]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void listAdminUsers()
      .then((rows) => {
        if (!cancelled) setAdminUsers(rows.filter((row) => row.role !== "admin"));
      })
      .catch(() => {
        // Without the list an admin simply cannot open the lead picker; the
        // rest of the page still works.
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const selectGroup = useCallback(
    async (groupId: string) => {
      setActiveId(groupId);
      setEditingUser(null);
      setPasswordTarget(null);
      setConfirmDelete(false);
      setError("");
      setNotice("");
      try {
        await loadGroup(groupId);
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [loadGroup],
  );

  const addMember = useCallback(async () => {
    if (!group) return;
    setBusy("add");
    setError("");
    setNotice("");
    try {
      await createGroupMember(group.id, newUsername.trim(), newPassword);
      setNewUsername("");
      setNewPassword("");
      await loadGroup(group.id);
      setNotice(t("Member added."));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  }, [group, loadGroup, newPassword, newUsername, t]);

  const removeMember = useCallback(
    async (username: string) => {
      if (!group) return;
      setBusy(`remove:${username}`);
      setError("");
      setNotice("");
      try {
        await removeGroupMember(group.id, username);
        if (editingUser === username) setEditingUser(null);
        await loadGroup(group.id);
        setNotice(t("Member removed."));
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy("");
      }
    },
    [editingUser, group, loadGroup, t],
  );

  const submitPassword = useCallback(async () => {
    if (!group || !passwordTarget) return;
    setBusy(`password:${passwordTarget}`);
    setError("");
    setNotice("");
    try {
      await resetGroupMemberPassword(group.id, passwordTarget, passwordValue);
      setPasswordTarget(null);
      setPasswordValue("");
      setNotice(t("Password reset."));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  }, [group, passwordTarget, passwordValue, t]);

  const openGrants = useCallback(
    async (username: string) => {
      if (!group) return;
      setEditingUser(username);
      setError("");
      setNotice("");
      try {
        const current = await getGroupMemberGrants(group.id, username);
        const nextModels: Record<string, string[]> = {};
        for (const item of current.models) {
          nextModels[item.profile_id] = item.model_ids ?? [];
        }
        setModels(nextModels);
        setKbs(
          current.knowledge_bases.map((item) => item.name ?? item.kb_name ?? "").filter(Boolean),
        );
        setSkills(
          current.skills.map((item) => item.skill_id ?? item.id ?? "").filter(Boolean),
        );
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [group],
  );

  const toggleModel = useCallback((profileId: string, modelId: string) => {
    setModels((previous) => {
      const current = previous[profileId] ?? [];
      const next = current.includes(modelId)
        ? current.filter((item) => item !== modelId)
        : [...current, modelId];
      return { ...previous, [profileId]: next };
    });
  }, []);

  const saveGrants = useCallback(async () => {
    if (!group || !editingUser) return;
    setBusy(`grants:${editingUser}`);
    setError("");
    setNotice("");
    const payload: GroupMemberGrant = {
      models: Object.entries(models)
        .filter(([, ids]) => ids.length > 0)
        .map(([profile_id, model_ids]) => ({ profile_id, model_ids })),
      knowledge_bases: kbs.map((name) => ({ name })),
      skills: skills.map((skill_id) => ({ skill_id })),
    };
    try {
      await setGroupMemberGrants(group.id, editingUser, payload);
      setEditingUser(null);
      await loadGroup(group.id);
      setNotice(t("Access updated."));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  }, [editingUser, group, kbs, loadGroup, models, skills, t]);

  const inactiveMembers = report.filter((entry) => {
    if (entry.user_id === group?.lead_user_id) return false;
    const idle = daysSince(entry.last_active_at);
    return idle === null || idle >= 7;
  });

  const sendReminders = useCallback(
    async (usernames: string[]) => {
      if (!group) return;
      if (usernames.length === 0) {
        setNotice(t("Nothing to remind: everyone was active this week."));
        return;
      }
      setBusy("remind");
      setError("");
      setNotice("");
      try {
        const result = await remindMembers(group.id, usernames);
        await loadGroup(group.id);
        setNotice(t("Reminded {{count}} member(s).", { count: result.reminded }));
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy("");
      }
    },
    [group, loadGroup, t],
  );

  const copyReminderText = useCallback(async () => {
    const names = inactiveMembers.map((entry) => entry.username);
    if (names.length === 0) {
      setNotice(t("Nothing to remind: everyone was active this week."));
      return;
    }
    const text = names
      .map((name) =>
        t(
          "{{name}}, we have not seen activity from you this week — please take a few minutes to continue.",
          { name },
        ),
      )
      .join("\n");
    try {
      await copyText(text);
      setNotice(t("Copied reminder text."));
    } catch (err) {
      setError(messageOf(err));
    }
  }, [inactiveMembers, t]);

  const saveMembers = useCallback(async () => {
    if (!group || memberDraft === null) return;
    setBusy("members");
    setError("");
    setNotice("");
    try {
      await setGroupMembers(group.id, memberDraft);
      setMemberDraft(null);
      await loadGroup(group.id);
      setNotice(t("Members updated."));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  }, [group, loadGroup, memberDraft, t]);

  const exportCsv = useCallback(() => {
    if (!weekly) return;
    const header = [t("Username"), t("Tokens"), t("Calls")];
    const rows = weekly.members.map((row) => [
      row.username,
      String(row.total_tokens),
      String(row.calls),
    ]);
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv =
      "\uFEFF" +
      [header, ...rows]
        .map((columns) => columns.map(escape).join(","))
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${group?.name ?? "group"}-weekly-${weekly.days}d.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [group, t, weekly]);

  const copyMarkdown = useCallback(async () => {
    if (!weekly) return;
    const lines = [
      `### ${group?.name ?? ""} · ${t("Last {{days}} days", { days: weekly.days })}`,
      "",
      `| ${t("Username")} | ${t("Tokens")} | ${t("Calls")} |`,
      "| --- | --- | --- |",
      ...weekly.members.map(
        (row) => `| ${row.username} | ${row.total_tokens} | ${row.calls} |`,
      ),
      "",
      `**${t("Total")}**: ${weekly.total_tokens}`,
    ];
    try {
      await copyText(lines.join("\n"));
      setNotice(t("Copied."));
    } catch (err) {
      setError(messageOf(err));
    }
  }, [group, t, weekly]);

  const submitGroup = useCallback(async () => {
    setBusy("create");
    setError("");
    setNotice("");
    try {
      const created = await createGroup({
        name: draftName.trim(),
        lead_user_id: draftLead,
        member_user_ids: draftMembers,
      });
      setDraftName("");
      setDraftLead("");
      setDraftMembers([]);
      const list = await listGroups();
      setGroups(list);
      setActiveId(created.id);
      await loadGroup(created.id);
      setNotice(t("Group created."));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  }, [draftLead, draftMembers, draftName, loadGroup, t]);

  const removeGroup = useCallback(async () => {
    if (!group) return;
    setBusy("delete-group");
    setError("");
    setNotice("");
    try {
      await deleteGroup(group.id);
      setConfirmDelete(false);
      const list = await listGroups();
      setGroups(list);
      if (list.length > 0) {
        setActiveId(list[0].id);
        await loadGroup(list[0].id);
      } else {
        setGroup(null);
        setReport([]);
        setWeekly(null);
      }
      setNotice(t("Group deleted."));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  }, [group, loadGroup, t]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--background)] px-4 py-10">
        <p className="mx-auto max-w-4xl text-sm text-[var(--muted-foreground)]">
          {t("Loading…")}
        </p>
      </div>
    );
  }

  const adminCard = isAdmin ? (
    <div className={cardClass}>
      <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
        <Users size={16} />
        {t("Create group")}
      </h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <input
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder={t("Group name")}
          className={inputClass}
        />
        <select
          value={draftLead}
          onChange={(event) => setDraftLead(event.target.value)}
          className={inputClass}
          aria-label={t("Lead")}
        >
          <option value="">{t("Lead")}</option>
          {adminUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.username}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy === "create" || draftName.trim().length === 0 || !draftLead}
          onClick={() => void submitGroup()}
        >
          {t("Create")}
        </button>
      </div>
      <div className="mt-3">
        <p className="text-xs text-[var(--muted-foreground)]">{t("Initial members")}</p>
        <div className="mt-1 flex flex-wrap gap-3">
          {adminUsers
            .filter((user) => user.id !== draftLead)
            .map((user) => (
              <label
                key={user.id}
                className="flex items-center gap-1.5 text-xs text-[var(--foreground)]"
              >
                <input
                  type="checkbox"
                  checked={draftMembers.includes(user.id)}
                  onChange={() =>
                    setDraftMembers((previous) =>
                      previous.includes(user.id)
                        ? previous.filter((id) => id !== user.id)
                        : [...previous, user.id],
                    )
                  }
                />
                {user.username}
              </label>
            ))}
        </div>
      </div>
      {group && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--destructive)]">
                {t("Delete this group? Members keep their accounts.")}
              </span>
              <button
                type="button"
                className={buttonClass}
                disabled={busy === "delete-group"}
                onClick={() => void removeGroup()}
              >
                {t("Confirm delete")}
              </button>
              <button type="button" className={buttonClass} onClick={() => setConfirmDelete(false)}>
                {t("Cancel")}
              </button>
            </div>
          ) : (
            <button type="button" className={buttonClass} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} />
              {t("Delete group")}
            </button>
          )}
        </div>
      )}
    </div>
  ) : null;

  if (groups.length === 0 && !isAdmin) {
    return (
      <div className="min-h-screen bg-[var(--background)] px-4 py-10">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className={cardClass}>
            <h1 className="text-lg font-semibold text-[var(--foreground)]">{t("Groups")}</h1>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {t("You do not lead any group.")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Users size={18} className="text-[var(--primary)]" />
            <h1 className="text-lg font-semibold text-[var(--foreground)]">{t("Groups")}</h1>
          </div>
          {groups.length > 1 && (
            <select
              value={activeId}
              onChange={(event) => void selectGroup(event.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--foreground)]"
              aria-label={t("Group")}
            >
              {groups.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            {notice}
          </p>
        )}

        {adminCard}

        {group && (
          <>
            <div className={cardClass}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-[var(--foreground)]">
                  {group.name} · {t("Members")}
                </h2>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy === "remind"}
                    onClick={() => void sendReminders(inactiveMembers.map((e) => e.username))}
                  >
                    {t("Remind inactive")}
                  </button>
                  <button type="button" className={buttonClass} onClick={() => void copyReminderText()}>
                    {t("Copy reminder text")}
                  </button>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-[var(--muted-foreground)]">
                    <tr>
                      <th className="py-2 pr-3 font-medium">{t("Username")}</th>
                      <th className="py-2 pr-3 font-medium">{t("Status")}</th>
                      <th className="py-2 pr-3 font-medium">{t("Progress")}</th>
                      <th className="py-2 pr-3 font-medium">{t("Last active")}</th>
                      <th className="py-2 pr-3 font-medium">{t("Access")}</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {report.map((entry) => {
                      const isLead = entry.user_id === group.lead_user_id;
                      const idle = daysSince(entry.last_active_at);
                      return (
                        <tr key={entry.user_id} className="border-t border-[var(--border)]">
                          <td className="py-2.5 pr-3 text-[var(--foreground)]">
                            {entry.username}
                            {isLead && (
                              <span className="ml-2 rounded bg-[var(--primary)]/10 px-1.5 py-0.5 text-[11px] text-[var(--primary)]">
                                {t("Lead")}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 text-[var(--muted-foreground)]">
                            {entry.disabled
                              ? t("Disabled")
                              : entry.must_change_password
                                ? t("Must change password")
                                : t("Active")}
                          </td>
                          <td className="py-2.5 pr-3 text-[var(--muted-foreground)]">
                            {entry.learning
                              ? t("{{paths}} paths · {{mastery}}% mastery", {
                                  paths: entry.learning.paths,
                                  mastery: entry.learning.mastery_pct,
                                })
                              : "—"}
                          </td>
                          <td className="py-2.5 pr-3 text-[var(--muted-foreground)]">
                            {entry.last_active_at
                              ? t("{{days}} days ago", { days: idle ?? 0 })
                              : t("Never active")}
                          </td>
                          <td className="py-2.5 pr-3 text-[var(--muted-foreground)]">
                            {t("{{models}} models · {{kbs}} knowledge bases · {{skills}} skills", {
                              models: entry.grant_summary.model_count,
                              kbs: entry.grant_summary.knowledge_base_count,
                              skills: entry.grant_summary.skill_count,
                            })}
                            {entry.last_reminded_at && (
                              <span className="ml-2 text-[11px]">
                                {t("Reminded {{days}} days ago", {
                                  days: daysSince(entry.last_reminded_at) ?? 0,
                                })}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5">
                            {!isLead && (
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <button
                                  type="button"
                                  className={buttonClass}
                                  disabled={busy === "remind"}
                                  onClick={() => void sendReminders([entry.username])}
                                >
                                  {t("Remind")}
                                </button>
                                <button
                                  type="button"
                                  className={buttonClass}
                                  onClick={() => void openGrants(entry.username)}
                                >
                                  {t("Edit access")}
                                </button>
                                <button
                                  type="button"
                                  className={buttonClass}
                                  onClick={() => {
                                    setPasswordTarget(entry.username);
                                    setPasswordValue("");
                                  }}
                                >
                                  <KeyRound size={14} />
                                  {t("Reset password")}
                                </button>
                                <button
                                  type="button"
                                  className={buttonClass}
                                  disabled={busy === `remove:${entry.username}`}
                                  onClick={() => void removeMember(entry.username)}
                                >
                                  <Trash2 size={14} />
                                  {t("Remove")}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                {t("Removing someone detaches them from the group. The account is kept.")}
              </p>
            </div>

            {isAdmin && (
              <div className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-[var(--foreground)]">
                    {t("Manage members")}
                  </h2>
                  {memberDraft === null ? (
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() =>
                        setMemberDraft(
                          group.member_user_ids.filter(
                            (id) => id !== group.lead_user_id,
                          ),
                        )
                      }
                    >
                      {t("Edit roster")}
                    </button>
                  ) : (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        className={primaryButtonClass}
                        disabled={busy === "members"}
                        onClick={() => void saveMembers()}
                      >
                        {t("Save members")}
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => setMemberDraft(null)}
                      >
                        {t("Cancel")}
                      </button>
                    </div>
                  )}
                </div>
                {memberDraft === null ? (
                  <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                    {t("Only an admin can add an existing account to a group.")}
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {adminUsers
                      .filter((user) => user.id !== group.lead_user_id)
                      .map((user) => (
                        <label
                          key={user.id}
                          className="flex items-center gap-1.5 text-xs text-[var(--foreground)]"
                        >
                          <input
                            type="checkbox"
                            checked={memberDraft.includes(user.id)}
                            onChange={() =>
                              setMemberDraft((previous) =>
                                previous === null
                                  ? previous
                                  : previous.includes(user.id)
                                    ? previous.filter((id) => id !== user.id)
                                    : [...previous, user.id],
                              )
                            }
                          />
                          {user.username}
                        </label>
                      ))}
                  </div>
                )}
              </div>
            )}

            {weekly && (
              <div className={cardClass}>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-[var(--foreground)]">
                    {t("Weekly usage")} · {t("Last {{days}} days", { days: weekly.days })}
                  </h2>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => void copyMarkdown()}
                  >
                    {t("Copy as Markdown")}
                  </button>
                  <button type="button" className={buttonClass} onClick={() => exportCsv()}>
                    {t("Export CSV")}
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => void loadGroup(group.id)}
                  >
                    <RefreshCw size={14} />
                    {t("Refresh")}
                  </button>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-[var(--muted-foreground)]">
                      <tr>
                        <th className="py-2 pr-3 font-medium">{t("Username")}</th>
                        <th className="py-2 pr-3 font-medium">{t("Tokens")}</th>
                        <th className="py-2 font-medium">{t("Calls")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekly.members.map((row) => (
                        <tr key={row.user_id} className="border-t border-[var(--border)]">
                          <td className="py-2 pr-3 text-[var(--foreground)]">{row.username}</td>
                          <td className="py-2 pr-3 text-[var(--muted-foreground)]">
                            {row.total_tokens.toLocaleString()}
                          </td>
                          <td className="py-2 text-[var(--muted-foreground)]">{row.calls}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-[var(--border)] font-medium">
                        <td className="py-2 pr-3 text-[var(--foreground)]">{t("Total")}</td>
                        <td className="py-2 pr-3 text-[var(--foreground)]">
                          {weekly.total_tokens.toLocaleString()}
                        </td>
                        <td className="py-2" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {passwordTarget && (
              <div className={cardClass}>
                <h2 className="text-sm font-medium text-[var(--foreground)]">
                  {t("Reset password")} · {passwordTarget}
                </h2>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    value={passwordValue}
                    onChange={(event) => setPasswordValue(event.target.value)}
                    placeholder={t("New password")}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    className={primaryButtonClass}
                    disabled={passwordValue.length < 8 || busy === `password:${passwordTarget}`}
                    onClick={() => void submitPassword()}
                  >
                    {t("Save")}
                  </button>
                  <button type="button" className={buttonClass} onClick={() => setPasswordTarget(null)}>
                    {t("Cancel")}
                  </button>
                </div>
              </div>
            )}

            <div className={cardClass}>
              <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                <UserPlus size={16} />
                {t("Add member")}
              </h2>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={newUsername}
                  onChange={(event) => setNewUsername(event.target.value)}
                  placeholder={t("Username")}
                  className={inputClass}
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={t("Initial password")}
                  className={inputClass}
                />
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={busy === "add" || newUsername.trim().length < 2 || newPassword.length < 8}
                  onClick={() => void addMember()}
                >
                  {t("Add")}
                </button>
              </div>
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                {t("New members are ordinary accounts and are asked to change the password.")}
              </p>
            </div>

            {editingUser && grantable && (
              <div className={cardClass}>
                <h2 className="text-sm font-medium text-[var(--foreground)]">
                  {t("Access")} · {editingUser}
                </h2>

                <div className="mt-4 space-y-4">
                  <div>
                    <h3 className="text-xs font-medium text-[var(--muted-foreground)]">
                      {t("Models")}
                    </h3>
                    {grantable.models.length === 0 && (
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t("None")}</p>
                    )}
                    {grantable.models.map((profile) => (
                      <div key={profile.profile_id} className="mt-2">
                        <p className="text-xs text-[var(--foreground)]">
                          {profile.name || profile.profile_id}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-3">
                          {profile.model_ids.map((modelId) => (
                            <label
                              key={`${profile.profile_id}:${modelId}`}
                              className="flex items-center gap-1.5 text-xs text-[var(--foreground)]"
                            >
                              <input
                                type="checkbox"
                                checked={(models[profile.profile_id] ?? []).includes(modelId)}
                                onChange={() => toggleModel(profile.profile_id, modelId)}
                              />
                              {modelId}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <h3 className="text-xs font-medium text-[var(--muted-foreground)]">
                      {t("Knowledge bases")}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {grantable.knowledge_bases.length === 0 && (
                        <p className="text-xs text-[var(--muted-foreground)]">{t("None")}</p>
                      )}
                      {grantable.knowledge_bases.map((item) => {
                        const name = item.name ?? item.kb_name ?? item.resource_id ?? item.id ?? "";
                        if (!name) return null;
                        return (
                          <label
                            key={name}
                            className="flex items-center gap-1.5 text-xs text-[var(--foreground)]"
                          >
                            <input
                              type="checkbox"
                              checked={kbs.includes(name)}
                              onChange={() =>
                                setKbs((previous) =>
                                  previous.includes(name)
                                    ? previous.filter((entry) => entry !== name)
                                    : [...previous, name],
                                )
                              }
                            />
                            {name}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-medium text-[var(--muted-foreground)]">
                      {t("Skills")}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {grantable.skills.length === 0 && (
                        <p className="text-xs text-[var(--muted-foreground)]">{t("None")}</p>
                      )}
                      {grantable.skills.map((item) => {
                        const skillId = item.skill_id ?? item.id ?? "";
                        if (!skillId) return null;
                        return (
                          <label
                            key={skillId}
                            className="flex items-center gap-1.5 text-xs text-[var(--foreground)]"
                          >
                            <input
                              type="checkbox"
                              checked={skills.includes(skillId)}
                              onChange={() =>
                                setSkills((previous) =>
                                  previous.includes(skillId)
                                    ? previous.filter((entry) => entry !== skillId)
                                    : [...previous, skillId],
                                )
                              }
                            />
                            {skillId}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    className={primaryButtonClass}
                    disabled={busy === `grants:${editingUser}`}
                    onClick={() => void saveGrants()}
                  >
                    {t("Save access")}
                  </button>
                  <button type="button" className={buttonClass} onClick={() => setEditingUser(null)}>
                    {t("Cancel")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
