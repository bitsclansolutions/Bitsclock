/**
 * Permission catalog. A role is a set of these keys; the Administrator system
 * role implicitly holds every key. Keys are stored in the database, keep them stable.
 */
export const PERMISSION_GROUPS = [
  {
    key: "time",
    label: "Time tracking",
    permissions: [
      { key: "time.track", label: "Track own time", description: "Start timers and log manual entries for themselves." },
      { key: "time.view_all", label: "View everyone's time", description: "See the time entries of all members." },
      { key: "time.manage_all", label: "Edit everyone's time", description: "Add, edit and delete other members' entries." },
    ],
  },
  {
    key: "projects",
    label: "Projects",
    permissions: [
      { key: "projects.view", label: "View projects", description: "See the project list and pick a project when tracking." },
      { key: "projects.manage", label: "Manage projects", description: "Create, edit, archive and delete projects." },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    permissions: [
      { key: "reports.view_own", label: "View own reports", description: "Run reports on their own time." },
      { key: "reports.view_all", label: "View team reports", description: "Run reports across all members and projects." },
      { key: "reports.export", label: "Export reports", description: "Download reports as CSV or PDF." },
    ],
  },
  {
    key: "dashboard",
    label: "Dashboard",
    permissions: [
      { key: "dashboard.team", label: "Team overview", description: "See team-wide totals and who is tracking right now." },
    ],
  },
  {
    key: "team",
    label: "Team & access",
    permissions: [
      { key: "users.view", label: "View members", description: "See the member list." },
      { key: "users.manage", label: "Manage members", description: "Add members, assign roles, deactivate and reset passwords." },
      { key: "roles.manage", label: "Manage roles", description: "Create roles and choose their permissions." },
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export const ADMIN_ROLE_NAME = "Administrator";
export const EMPLOYEE_ROLE_NAME = "Employee";

export const DEFAULT_EMPLOYEE_PERMISSIONS: Permission[] = ["time.track", "projects.view", "reports.view_own", "reports.export"];

export function isValidPermission(key: string): key is Permission {
  return PERMISSION_SET.has(key);
}
