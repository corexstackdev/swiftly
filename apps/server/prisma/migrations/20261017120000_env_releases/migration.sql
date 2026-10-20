-- CreateTable
CREATE TABLE "application_releases" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_releases_applicationId_environmentId_key" ON "application_releases"("applicationId", "environmentId");

-- CreateIndex
CREATE INDEX "application_releases_environmentId_idx" ON "application_releases"("environmentId");

-- AddForeignKey
ALTER TABLE "application_releases" ADD CONSTRAINT "application_releases_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_releases" ADD CONSTRAINT "application_releases_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_releases" ADD CONSTRAINT "application_releases_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "application_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing published apps become the production (or default) release.
INSERT INTO "application_releases" ("id", "applicationId", "environmentId", "versionId", "publishedAt")
SELECT gen_random_uuid()::text,
       a.id,
       e.id,
       a."publishedVersionId",
       COALESCE(v."publishedAt", CURRENT_TIMESTAMP)
  FROM "applications" a
  JOIN "workspaces" w ON w.id = a."workspaceId"
  JOIN "application_versions" v ON v.id = a."publishedVersionId"
  JOIN LATERAL (
        SELECT env.id
          FROM "environments" env
         WHERE env."organizationId" = w."organizationId"
         ORDER BY env."isProduction" DESC, env."isDefault" DESC
         LIMIT 1
       ) e ON true
 WHERE a."publishedVersionId" IS NOT NULL
ON CONFLICT ("applicationId", "environmentId") DO NOTHING;
