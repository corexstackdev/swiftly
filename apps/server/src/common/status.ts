/**
 * Row statuses that used to be Postgres enums.
 *
 * SQLite has no enum type, so Prisma no longer generates these and the columns
 * are plain strings. The literals are unchanged, so the same values round-trip
 * on either engine — and keeping them in one place means a typo in a status
 * comparison is still a compile error rather than a silently false condition.
 */

export const VersionStatus = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PUBLISHED: 'PUBLISHED',
  ROLLED_BACK: 'ROLLED_BACK',
  ARCHIVED: 'ARCHIVED',
} as const;
export type VersionStatus = (typeof VersionStatus)[keyof typeof VersionStatus];

export const ApplicationStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const IdentityProviderType = {
  LOCAL: 'LOCAL',
  LDAP: 'LDAP',
  OIDC: 'OIDC',
  SAML: 'SAML',
} as const;
export type IdentityProviderType =
  (typeof IdentityProviderType)[keyof typeof IdentityProviderType];

export const ComponentIsolation = {
  IFRAME: 'IFRAME',
  INLINE: 'INLINE',
} as const;
export type ComponentIsolation = (typeof ComponentIsolation)[keyof typeof ComponentIsolation];

/**
 * A permission list read back out of a Json column.
 *
 * Prisma types a Json field as "could be anything", because that is the truth:
 * the column is whatever was last written to it. Everything that is not a list
 * of strings is dropped rather than trusted, so a corrupt row costs a user
 * their permissions instead of granting them something arbitrary.
 */
export function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry: unknown): entry is string => typeof entry === 'string');
}
