import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from '@/lib/session';
import { LoginPage } from '@/pages/LoginPage';
import { AppListPage } from '@/pages/AppListPage';
import { ReviewsPage } from '@/pages/ReviewsPage';
import { PublishedAppPage } from '@/pages/PublishedAppPage';
import { DraftPreviewPage } from '@/pages/DraftPreviewPage';
import { EditorPage } from '@/editor/EditorPage';
import { DataSectionPage } from '@/data/DataSectionPage';

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Hosted app URLs — no Swiftly login. Preview is the live draft; published is frozen. */}
          <Route path="/app/:workspaceSlug/:appSlug/preview" element={<DraftPreviewPage />} />
          <Route path="/apps/:applicationId/preview" element={<DraftPreviewPage />} />
          <Route
            path="/app/:workspaceSlug/:appSlug/:environmentName"
            element={<PublishedAppPage />}
          />
          <Route path="/app/:workspaceSlug/:appSlug" element={<PublishedAppPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/apps" element={<AppListPage />} />
            <Route path="/apps/:applicationId/edit" element={<EditorPage />} />
            <Route path="/apps/:applicationId/data" element={<DataSectionPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/apps" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}

function RequireAuth() {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }
  if (!user) {
    const from = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?from=${from}`} replace />;
  }

  return <Outlet />;
}
