import { z } from "zod";
import { isValidPermission } from "./permissions";
import { CUID_RE, EMAIL_RE, HEX_COLOR_RE, LIMITS, NAME_RE, cleanEmail, cleanMultiline, cleanText } from "./sanitize";

/**
 * Every request body and query string is validated against one of these schemas.
 * They are plain zod (no server imports) so the browser forms run the exact same
 * checks before sending, and the API runs them again before touching the database.
 * All object schemas are `.strict()`: unknown keys are rejected, not ignored.
 */

// ---- field primitives -------------------------------------------------------

export const idField = z.string().regex(CUID_RE, "Invalid id.");
export const optionalId = idField.nullable().optional();

const text = (max: number, label: string) =>
  z
    .string({ message: `${label} must be text.` })
    .max(max * 2, `${label} is too long.`)
    .transform(cleanText)
    .pipe(z.string().max(max, `Keep ${label.toLowerCase()} under ${max} characters.`));

const requiredText = (max: number, label: string) => text(max, label).pipe(z.string().min(1, `${label} is required.`));

const nameField = (max: number, label: string) =>
  requiredText(max, label).pipe(z.string().regex(NAME_RE, `${label} contains characters that aren't allowed.`));

export const emailField = z
  .string({ message: "Enter a valid email." })
  .max(LIMITS.email * 2)
  .transform(cleanEmail)
  .pipe(z.string().max(LIMITS.email, "Email is too long.").regex(EMAIL_RE, "Enter a valid email."));

export const passwordRule = z
  .string({ message: "Enter a password." })
  .min(8, "Password must be at least 8 characters.")
  .max(LIMITS.password, "Password is too long.")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use at least one letter and one number.");

/** Password the administrator may leave blank: the server then generates one and emails it. */
export const optionalPassword = z
  .union([passwordRule, z.literal("")])
  .optional()
  .transform((v) => (v ? v : undefined));

export const colorField = z.string().regex(HEX_COLOR_RE, "Pick a valid colour.");

/** ISO-8601 instant, parsed and bounded to a sane window. */
export const instantField = z
  .string({ message: "Enter a valid date." })
  .max(40)
  .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v)), "Enter a valid date.")
  .refine((v) => {
    const t = Date.parse(v);
    return t > Date.UTC(2000, 0, 1) && t < Date.UTC(2100, 0, 1);
  }, "Date is out of range.");

// ---- auth -------------------------------------------------------------------

export const loginSchema = z
  .object({
    email: emailField,
    password: z.string({ message: "Enter your password." }).min(1, "Enter your password.").max(LIMITS.password, "Password is too long."),
    remember: z.boolean().optional().default(false),
  })
  .strict();

export const logoutSchema = z.object({ everywhere: z.boolean().optional().default(false) }).strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(LIMITS.password),
    newPassword: passwordRule,
  })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, { message: "Choose a different password.", path: ["newPassword"] });

export const forgotPasswordSchema = z.object({ email: emailField }).strict();

export const resetCodeField = z
  .string({ message: "Enter the 6-digit code from the email." })
  .max(20)
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from the email."));

export const resetPasswordSchema = z
  .object({
    email: emailField,
    code: resetCodeField,
    newPassword: passwordRule,
  })
  .strict();

/** Administrator resets a member's password; blank = generate one and email it. */
export const adminResetPasswordSchema = z.object({ password: optionalPassword }).strict();

export const profileSchema = z
  .object({
    name: nameField(LIMITS.name, "Name"),
    jobTitle: text(LIMITS.jobTitle, "Job title").optional().default(""),
  })
  .strict();

// ---- projects ---------------------------------------------------------------

export const projectCreateSchema = z
  .object({
    name: requiredText(LIMITS.projectName, "Project name"),
    description: z.string().max(LIMITS.projectDescription * 2).transform(cleanMultiline).pipe(z.string().max(LIMITS.projectDescription, "Keep the description under 1000 characters.")).optional().default(""),
    color: colorField.optional(),
    billable: z.boolean().optional().default(true),
    memberMode: z.enum(["all", "selected"]).optional().default("all"),
    memberIds: z.array(idField).max(500, "Too many members.").optional().default([]),
    kind: z.enum(["project", "activity"]).optional().default("project"),
  })
  .strict();

export const projectUpdateSchema = projectCreateSchema.partial().extend({ isArchived: z.boolean().optional() }).strict();


// ---- users ------------------------------------------------------------------

export const userCreateSchema = z
  .object({
    name: nameField(LIMITS.name, "Name"),
    email: emailField,
    password: optionalPassword,
    roleId: idField,
    jobTitle: text(LIMITS.jobTitle, "Job title").optional().default(""),
  })
  .strict();

export const userUpdateSchema = z
  .object({
    name: nameField(LIMITS.name, "Name").optional(),
    email: emailField.optional(),
    password: passwordRule.optional(),
    roleId: idField.optional(),
    jobTitle: text(LIMITS.jobTitle, "Job title").optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

// ---- roles ------------------------------------------------------------------

const permissionList = z
  .array(z.string().max(60))
  .max(100)
  .refine((arr) => arr.every(isValidPermission), "Unknown permission.")
  .transform((arr) => Array.from(new Set(arr)));

export const roleCreateSchema = z
  .object({
    name: nameField(LIMITS.roleName, "Role name"),
    description: text(LIMITS.roleDescription, "Description").optional().default(""),
    color: colorField.optional(),
    permissions: permissionList,
  })
  .strict();

export const roleUpdateSchema = roleCreateSchema.partial().strict();

// ---- time entries -----------------------------------------------------------

const entryDescription = text(LIMITS.entryDescription, "Description");

// Billable is per entry; when omitted the entry copies the flag from its project.
export const entryStartSchema = z
  .object({
    description: entryDescription.optional().default(""),
    projectId: optionalId,
    billable: z.boolean().optional(),
  })
  .strict();

export const entryManualSchema = z
  .object({
    description: entryDescription.optional().default(""),
    projectId: optionalId,
    billable: z.boolean().optional(),
    startTime: instantField,
    endTime: instantField,
    userId: idField.or(z.literal("me")).optional(),
  })
  .strict();

export const entryUpdateSchema = z
  .object({
    description: entryDescription.optional(),
    projectId: optionalId,
    billable: z.boolean().optional(),
    startTime: instantField.optional(),
    endTime: instantField.optional(),
  })
  .strict();

// ---- bulk ------------------------------------------------------------------

/** Up to 200 manual entries in one request; `atomic` (default) means all or nothing. */
export const entriesBulkCreateSchema = z
  .object({
    entries: z.array(entryManualSchema.omit({ userId: true })).min(1, "Send at least one entry.").max(200, "At most 200 entries per request."),
    userId: idField.or(z.literal("me")).optional(),
    atomic: z.boolean().optional().default(true),
  })
  .strict();

export const entriesBulkDeleteSchema = z.object({ ids: z.array(idField).min(1).max(500, "At most 500 ids per request.") }).strict();

// ---- query strings ----------------------------------------------------------

const optionalInstant = instantField.optional();
const zoneField = z.string().max(64).regex(/^[A-Za-z0-9_+\-/]+$/, "Invalid time zone.").optional();

export const reportQuerySchema = z.object({
  from: instantField,
  to: instantField,
  tz: zoneField,
  userId: idField.or(z.enum(["me", "all"])).optional(),
  projectId: idField.or(z.literal("none")).optional(),
  billable: z.enum(["all", "billable", "non_billable"]).optional(),
  q: z.string().max(LIMITS.search * 2).transform(cleanText).pipe(z.string().max(LIMITS.search)).optional(),
  kind: z.enum(["detailed", "summary"]).optional(),
  compare: z.enum(["0", "1"]).optional(),
});

export const dashboardQuerySchema = z.object({
  tz: zoneField,
  dayStart: optionalInstant,
  weekStart: optionalInstant,
  monthStart: optionalInstant,
});

export const usersQuerySchema = z.object({ weekStart: optionalInstant });
export const projectsQuerySchema = z.object({ includeArchived: z.enum(["0", "1"]).optional() });
export const roleDeleteQuerySchema = z.object({ reassignTo: idField.optional() });
export const suggestQuerySchema = z.object({ q: z.string().max(LIMITS.search * 2).transform(cleanText).pipe(z.string().max(LIMITS.search)) });

/** Run a schema in the browser before sending; returns the first error message or null. */
export function clientCheck<T>(schema: z.ZodType<T>, data: unknown): string | null {
  const r = schema.safeParse(data);
  if (r.success) return null;
  const issue = r.error.issues[0];
  return issue ? issue.message : "Check the form and try again.";
}
