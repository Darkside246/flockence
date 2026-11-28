export type EmailCategoryId = "signup_verification" | "welcome" | "password_reset" | "team_invitation" | "vision_daily_report" | "vision_alert";
export type EmailTemplateField = "subject" | "intro" | "footer";
export type EmailTemplateText = Partial<Record<EmailTemplateField, string>>;
export type EmailMessage = { subject: string; text?: string; html?: string };
export interface EmailCategory { id: EmailCategoryId; group: "account" | "farm"; label: string; subject: string; hint: string }
export const emailCategories: EmailCategory[];
export const emailCategoryIds: EmailCategoryId[];
export const EMAIL_TEMPLATE_LIMITS: Record<EmailTemplateField, number>;
export const emailTemplateFields: EmailTemplateField[];
export function isEmailCategory(id: unknown): id is EmailCategoryId;
export function emailCategory(id: string): EmailCategory | null;
export function emailTemplateKey(category: EmailCategoryId, field: EmailTemplateField): string;
export function cleanTemplateField(field: EmailTemplateField, value: unknown): string;
export function applyEmailTemplate<T extends EmailMessage>(category: EmailCategoryId, message: T, template: EmailTemplateText | null | undefined, values?: { farm?: string }): T;
export function sampleMessage(category: EmailCategoryId, baseUrl: string): EmailMessage | null;
