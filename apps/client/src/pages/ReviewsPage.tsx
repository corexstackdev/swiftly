import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PendingReview } from '@/lib/api';

/**
 * The IT review queue.
 *
 * A reviewer sees what changed against the currently published version rather than
 * a wall of JSON, and approval and deployment are separate steps so a change can be
 * signed off now and rolled out in a maintenance window.
 */

export function ReviewsPage() {
  const [pending, setPending] = useState<PendingReview[]>([]);
  const [diffs, setDiffs] = useState<Record<string, Record<string, unknown>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    api.publish
      .pending()
      .then(setPending)
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  };

  useEffect(load, []);

  const showDiff = async (versionId: string): Promise<void> => {
    if (diffs[versionId]) return;
    const diff = await api.publish.diff(versionId);
    setDiffs((previous) => ({ ...previous, [versionId]: diff }));
  };

  const act = async (
    versionId: string,
    action: 'approve' | 'reject' | 'deploy',
  ): Promise<void> => {
    setBusy(versionId);
    setError(null);
    try {
      if (action === 'approve') {
        const notes = window.prompt('Review notes (optional)') ?? undefined;
        await api.publish.approve(versionId, notes);
        setMessage('Approved. Deploy it when you are ready to roll it out.');
      } else if (action === 'reject') {
        const reason = window.prompt('Why is this being rejected?');
        if (!reason) return;
        await api.publish.reject(versionId, reason);
        setMessage('Rejected and sent back to the builder.');
      } else {
        await api.publish.deploy(versionId);
        setMessage('Deployed. End users get this version on their next load.');
      }
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link to="/apps" className="text-sm text-slate-400 hover:text-slate-600">
            ←
          </Link>
          <h1 className="text-base font-semibold text-slate-900">Review queue</h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl p-6">
        {message && (
          <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>
        )}
        {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {pending.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm text-slate-500">Nothing awaiting review</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((review) => {
              const diff = diffs[review.id];
              return (
                <li key={review.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-medium text-slate-900">
                        {review.application.name}{' '}
                        <span className="font-normal text-slate-400">
                          v{review.versionNumber}
                        </span>
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Submitted by {review.submittedBy.name} ·{' '}
                        {new Date(review.submittedAt).toLocaleString()}
                      </p>
                      {review.changeNote && (
                        <p className="mt-2 rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                          {review.changeNote}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void showDiff(review.id)}
                        className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        What changed
                      </button>
                      <button
                        type="button"
                        disabled={busy === review.id}
                        onClick={() => void act(review.id, 'reject')}
                        className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={busy === review.id}
                        onClick={() => void act(review.id, 'approve')}
                        className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy === review.id}
                        onClick={() => void act(review.id, 'deploy')}
                        className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        title="Only an approved version can be deployed"
                      >
                        Deploy
                      </button>
                    </div>
                  </div>

                  {diff && <DiffSummary diff={diff} />}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

function DiffSummary({ diff }: { diff: Record<string, unknown> }) {
  const pages = diff.pages as { added: string[]; removed: string[]; changed: string[] };
  const queries = diff.queries as { added: string[]; removed: string[]; changed: string[] };
  const widgets = diff.widgetCount as { before: number; after: number };

  return (
    <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-xs sm:grid-cols-3">
      <ChangeGroup title="Pages" group={pages} />
      <ChangeGroup title="Queries" group={queries} />
      <div>
        <span className="font-medium text-slate-600">Widgets</span>
        <p className="text-slate-500">
          {widgets.before} → {widgets.after}
        </p>
        {Array.isArray(diff.datasourcesUsed) && diff.datasourcesUsed.length > 0 && (
          <p className="mt-1 text-slate-400">
            {diff.datasourcesUsed.length} datasource
            {diff.datasourcesUsed.length === 1 ? '' : 's'} referenced
          </p>
        )}
      </div>
    </div>
  );
}

function ChangeGroup({
  title,
  group,
}: {
  title: string;
  group: { added: string[]; removed: string[]; changed: string[] };
}) {
  const empty =
    group.added.length === 0 && group.removed.length === 0 && group.changed.length === 0;

  return (
    <div>
      <span className="font-medium text-slate-600">{title}</span>
      {empty ? (
        <p className="text-slate-400">No changes</p>
      ) : (
        <ul className="text-slate-500">
          {group.added.map((name) => (
            <li key={`a-${name}`} className="text-green-700">
              + {name}
            </li>
          ))}
          {group.removed.map((name) => (
            <li key={`r-${name}`} className="text-red-700">
              − {name}
            </li>
          ))}
          {group.changed.map((name) => (
            <li key={`c-${name}`} className="text-amber-700">
              ~ {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
