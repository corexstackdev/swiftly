import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from '@/lib/session';
import { LoginPage } from '@/pages/LoginPage';
import { AppListPage } from '@/pages/AppListPage';
import { ReviewsPage } from '@/pages/ReviewsPage';
import { PublishedAppPage } from '@/pages/PublishedAppPage';
import { EditorPage } from '@/editor/EditorPage';
import { DataSectionPage } from '@/data/DataSectionPage';

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/apps" element={<AppListPage />} />
            <Route path="/apps/:applicationId/edit" element={<EditorPage />} />
            <Route path="/apps/:applicationId/data" element={<DataSectionPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            {/* Published apps are deep-linkable, so a user can bookmark a page. */}
            <Route path="/app/:workspaceSlug/:appSlug" element={<PublishedAppPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/apps" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}

function RequireAuth() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}
