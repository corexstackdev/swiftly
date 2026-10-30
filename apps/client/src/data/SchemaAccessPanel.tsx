import { useState } from 'react';
import {
  SCHEMA_ACCESS_CODE,
  postgresSchemaGrantSql,
  type SchemaAccessHint,
} from '@swiftly/shared';
import { ApiError } from '@/lib/api';

export function schemaAccessFromError(
  error: unknown,
  fallback?: { schema: string; dbUser: string; owner?: string },
): SchemaAccessHint | null {
  if (error instanceof ApiError && error.details && typeof error.details === 'object') {
    const details = error.details as Partial<SchemaAccessHint>;
    if (details.code === SCHEMA_ACCESS_CODE && details.schema && details.sql && details.dbUser) {
      return {
        code: SCHEMA_ACCESS_CODE,
        schema: details.schema,
        dbUser: details.dbUser,
        owner: details.owner,
        sql: details.sql,
        message: details.message ?? error.message,
      };
    }
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!/permission denied|access denied/i.test(message) || !fallback) return null;
  return {
    code: SCHEMA_ACCESS_CODE,
    schema: fallback.schema,
    dbUser: fallback.dbUser,
    owner: fallback.owner,
    sql: postgresSchemaGrantSql(fallback.schema, fallback.dbUser),
    message,
  };
}

export function SchemaAccessPanel({
  hint,
  onRefresh,
  refreshing,
}: {
  hint: SchemaAccessHint;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(hint.sql);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-auto p-6">
      <div className="w-full max-w-xl">
        <p className="text-sm font-semibold text-slate-900">This schema needs access</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          This connection uses the database user <strong>{hint.dbUser}</strong>. Schema{' '}
          <strong>{hint.schema}</strong> is already in the database
          {hint.owner ? (
            <>
              {' '}
              (owned by <strong>{hint.owner}</strong>)
            </>
          ) : null}
          , but that user is not allowed to read or change it yet.
        </p>

        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
          <li>Copy the SQL below.</li>
          <li>
            Ask a database admin — or whoever created this schema — to run it in psql, pgAdmin, or
            DBeaver.
          </li>
          <li>
            Or, in <strong>Configurations</strong>, connect as the user who owns the schema, then
            Refresh.
          </li>
          <li>Come back here and click Refresh.</li>
        </ol>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
            <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
              SQL to run
            </span>
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
            >
              {copied ? 'Copied' : 'Copy SQL'}
            </button>
          </div>
          <pre className="overflow-auto px-3 py-3 text-[11px] leading-relaxed text-slate-700">
            {hint.sql}
          </pre>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="mt-4 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'I ran this — Refresh'}
        </button>
      </div>
    </div>
  );
}
