/**
 * Permission catalogue. Roles are named bundles of these strings; nothing in the
 * codebase checks a role name, only a permission, so a tenant can define its own
 * roles without core changes.
 */
export const PERMISSIONS = {
  // Applications
  APP_VIEW: 'app:view',
  APP_CREATE: 'app:create',
  APP_EDIT: 'app:edit',
  APP_DELETE: 'app:delete',
  /** Submit a version for review (legacy). Builders also use this to publish. */
  APP_SUBMIT: 'app:submit',
  /** Publish a frozen version to an environment. */
  APP_PUBLISH: 'app:publish',

  // Datasources
  DATASOURCE_VIEW: 'datasource:view',
  DATASOURCE_CREATE: 'datasource:create',
  DATASOURCE_EDIT: 'datasource:edit',
  DATASOURCE_DELETE: 'datasource:delete',

  // Queries
  QUERY_RUN: 'query:run',
  /** Run a statement that mutates data. */
  QUERY_WRITE: 'query:write',
  /** Disable prepared statements on a query — audited escape hatch. */
  QUERY_RAW_UNSAFE: 'query:raw_unsafe',

  // Workspaces
  WORKSPACE_VIEW: 'workspace:view',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_EDIT: 'workspace:edit',
  WORKSPACE_DELETE: 'workspace:delete',

  // Administration
  ORG_SETTINGS: 'org:settings',
  MEMBER_MANAGE: 'member:manage',
  ROLE_MANAGE: 'role:manage',
  IDP_MANAGE: 'idp:manage',
  COMPONENT_MANAGE: 'component:manage',
  AUDIT_VIEW: 'audit:view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/**
 * Built-in roles seeded for every organization. Builders publish the draft to
 * the environment they have selected (dev, test, stage, or production).
 */
export const SYSTEM_ROLES: Record<string, { description: string; permissions: Permission[] }> = {
  'Org Admin': {
    description: 'Full control of the organization',
    permissions: ALL_PERMISSIONS,
  },
  'App Builder': {
    description: 'Builds applications and publishes them to an environment',
    permissions: [
      PERMISSIONS.APP_VIEW,
      PERMISSIONS.APP_CREATE,
      PERMISSIONS.APP_EDIT,
      PERMISSIONS.APP_SUBMIT,
      PERMISSIONS.APP_PUBLISH,
      PERMISSIONS.DATASOURCE_VIEW,
      PERMISSIONS.DATASOURCE_CREATE,
      PERMISSIONS.DATASOURCE_EDIT,
      PERMISSIONS.QUERY_RUN,
      PERMISSIONS.QUERY_WRITE,
      PERMISSIONS.WORKSPACE_VIEW,
    ],
  },
  'IT Reviewer': {
    description: 'Publishes applications and audits changes',
    permissions: [
      PERMISSIONS.APP_VIEW,
      PERMISSIONS.APP_PUBLISH,
      PERMISSIONS.DATASOURCE_VIEW,
      PERMISSIONS.WORKSPACE_VIEW,
      PERMISSIONS.AUDIT_VIEW,
    ],
  },
  'App Viewer': {
    description: 'Uses published applications',
    permissions: [PERMISSIONS.APP_VIEW, PERMISSIONS.QUERY_RUN, PERMISSIONS.WORKSPACE_VIEW],
  },
};
