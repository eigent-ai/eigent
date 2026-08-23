// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { proxyFetchPost } from '@/api/http';
import { isDesktop } from '@/client/platform';
import { useAuthStore } from '@/store/authStore';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from '@/store/settingsStore';
import { lazy, useEffect, useReducer } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import Layout from '@/components/Layout';
import { LegacyRouteRedirect } from './LegacyRouteCompatibility';
import WorkspaceSettingsRouteLayout from './WorkspaceSettingsRouteLayout';
// Lazy load page components
const Login = lazy(() => import('@/pages/Login'));
const Signup = lazy(() => import('@/pages/SignUp'));
const Workspace = lazy(() => import('@/pages/Workspace'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const RemoteControl = lazy(() => import('@/pages/RemoteControl'));

const IS_LOCAL_MODE = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';
const ENABLE_DESKTOP_REMOTE_CONTROL_FALLBACK = isDesktop();

interface AuthState {
  loading: boolean;
  isAuthenticated: boolean;
  initialized: boolean;
}

type AuthAction =
  | { type: 'INITIALIZE'; payload: { isAuthenticated: boolean } }
  | { type: 'LOGOUT' };

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'INITIALIZE':
      return {
        loading: false,
        isAuthenticated: action.payload.isAuthenticated,
        initialized: true,
      };
    case 'LOGOUT':
      return {
        loading: false,
        isAuthenticated: false,
        initialized: true,
      };
    default:
      return state;
  }
};

// Route guard: Check if user is logged in
const ProtectedRoute = () => {
  const location = useLocation();
  const [state, dispatch] = useReducer(authReducer, {
    loading: false,
    isAuthenticated: false,
    initialized: false,
  });

  const {
    token,
    localProxyValue,
    logout,
    setAuth,
    setLocalProxyValue,
    setInitState,
    setIsFirstLaunch,
    setModelType,
  } = useAuthStore();
  useEffect(() => {
    // Check VITE_USE_LOCAL_PROXY value on app startup
    if (token) {
      const currentProxyValue = import.meta.env.VITE_USE_LOCAL_PROXY || null;
      const storedProxyValue = localProxyValue;

      // If stored value exists and differs from current, logout
      if (storedProxyValue !== null && storedProxyValue !== currentProxyValue) {
        console.warn('VITE_USE_LOCAL_PROXY value changed, logging out user');
        logout();
        dispatch({ type: 'LOGOUT' });
        return;
      }
    }

    // Local mode: auto-login when no token
    if (IS_LOCAL_MODE && !token) {
      proxyFetchPost('/api/v1/user/auto-login', {})
        .then((data) => {
          if (data && data.token) {
            setAuth({ email: data.email, ...data });
            setLocalProxyValue(import.meta.env.VITE_USE_LOCAL_PROXY || null);
            setModelType('custom');
            setInitState('done');
            setIsFirstLaunch(false);
            dispatch({
              type: 'INITIALIZE',
              payload: { isAuthenticated: true },
            });
          } else {
            dispatch({
              type: 'INITIALIZE',
              payload: { isAuthenticated: false },
            });
          }
        })
        .catch(() => {
          dispatch({
            type: 'INITIALIZE',
            payload: { isAuthenticated: false },
          });
        });
      return;
    }

    dispatch({ type: 'INITIALIZE', payload: { isAuthenticated: !!token } });
  }, [
    token,
    localProxyValue,
    logout,
    setAuth,
    setLocalProxyValue,
    setInitState,
    setIsFirstLaunch,
    setModelType,
  ]);

  if (state.loading || !state.initialized) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-x-0 border-t-0 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  if (state.isAuthenticated) {
    return <Outlet />;
  }

  const redirect = `${location.pathname}${location.search}`;
  return (
    <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  );
};

/** Keep legacy Settings links working while Home is the canonical surface. */
function SettingsRouteRedirect() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const sectionFromUrl = searchParams.get('section');
  const isLegacySettingsSection = SETTINGS_SECTIONS.includes(
    sectionFromUrl as SettingsSectionId
  );

  if (sectionFromUrl !== 'spaces') {
    searchParams.set('section', 'settings');
    if (
      sectionFromUrl &&
      isLegacySettingsSection &&
      sectionFromUrl !== 'settings'
    ) {
      searchParams.set('tab', sectionFromUrl);
    }
  }

  return (
    <Navigate
      to={`/home?${searchParams.toString()}`}
      replace
      state={location.state}
    />
  );
}

// Main route configuration
const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/signup" element={<Signup />} />
    {ENABLE_DESKTOP_REMOTE_CONTROL_FALLBACK ? (
      <Route path="/remote-control/:sessionId" element={<RemoteControl />} />
    ) : null}
    <Route element={<ProtectedRoute />}>
      <Route element={<Layout />}>
        <Route
          element={<WorkspaceSettingsRouteLayout workspace={<Workspace />} />}
        >
          <Route index element={null} />
          <Route path="/home" element={<Settings />} />
        </Route>
        <Route path="/settings" element={<SettingsRouteRedirect />} />
        <Route
          path="/history"
          element={<LegacyRouteRedirect kind="history" />}
        />
        <Route
          path="/workspace-configuration"
          element={<LegacyRouteRedirect kind="workspace-configuration" />}
        />
        <Route
          path="/workspace-bundles/install"
          element={<LegacyRouteRedirect kind="workspace-bundle-install" />}
        />
        <Route
          path="/agent-plugins/import"
          element={<LegacyRouteRedirect kind="agent-plugin-import" />}
        />
        <Route
          path="/setting"
          element={<Navigate to="/home?section=settings" replace />}
        />
        <Route
          path="/setting/*"
          element={<Navigate to="/home?section=settings" replace />}
        />
      </Route>
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>
);

export default AppRoutes;
