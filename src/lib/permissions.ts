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
      { key: "projects.view", label: "View projects", description: "Open the Projects page. Tracking time on assigned projects doesn't need this." },
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
      { key: "users.request", label: "Request new members", description: "Ask the Administrator to add a member; the Administrator approves or rejects." },
      { key: "users.deactivate", label: "Deactivate members", description: "Block sign-in for members who leave (never the Administrator or themselves)." },
      { key: "users.manage", label: "Manage members", description: "Add members, assign roles, reset passwords. Administrator only." },
      { key: "roles.manage", label: "Manage roles", description: "Create roles and choose their permissions. Administrator only." },
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export const ADMIN_ROLE_NAME = "Administrator";
export const EMPLOYEE_ROLE_NAME = "Employee";

/**
 * Any of these lets a member load the project list (/api/projects). The list itself is scoped
 * (loadProjects): non-managers get only the projects they may log time on, with their own
 * totals. So tracking time needs no projects.view: a member sees the projects they were added to.
 */
export const PROJECT_LIST_PERMISSIONS = [
  "projects.view",
  "projects.manage",
  "time.track",
  "time.view_all",
  "reports.view_own",
  "reports.view_all",
  "dashboard.team",
] as const satisfies readonly Permission[];

export const DEFAULT_EMPLOYEE_PERMISSIONS: Permission[] = ["time.track", "projects.view", "reports.view_own", "reports.export"];

/**
 * Held only by the Administrator role and never grantable to another role (D-001):
 * whoever can manage members or roles can make themselves Administrator.
 */
export const ADMIN_ONLY_PERMISSIONS = ["users.manage", "roles.manage"] as const satisfies readonly Permission[];
const ADMIN_ONLY_SET = new Set<string>(ADMIN_ONLY_PERMISSIONS);

/** Permissions a custom or Employee role may hold. */
export const GRANTABLE_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((p) => !ADMIN_ONLY_SET.has(p));

export function isValidPermission(key: string): key is Permission {
  return PERMISSION_SET.has(key);
}

export function isGrantablePermission(key: string): key is Permission {
  return PERMISSION_SET.has(key) && !ADMIN_ONLY_SET.has(key);
}

/** What a person may do, as one comparable string (role + permissions). Used to notice access changes. */
export function accessKey(u: { isAdmin: boolean; role: { id: string }; permissions: readonly string[] }) {
  return `${u.role.id}|${u.isAdmin ? "admin" : [...u.permissions].sort().join(",")}`;
}
