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

import { useAuthHydration } from '@/hooks/useAuthHydration';
import { useAuthStore } from '@/store/authStore';
import { lazy, useEffect, useReducer } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import Layout from '@/components/Layout';
// Lazy load page components
const Login = lazy(() => import('@/pages/Login'));
const Signup = lazy(() => import('@/pages/SignUp'));
const Home = lazy(() => import('@/pages/Home'));
const History = lazy(() => import('@/pages/History'));
const NotFound = lazy(() => import('@/pages/NotFound'));

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

// Route guard: Check if user is logged in.
// Waits for persisted auth store to hydrate before reading token to avoid
// temporary redirect to /login or flicker when the user is actually logged in.
const ProtectedRoute = () => {
  const hasHydrated = useAuthHydration();
  const [state, dispatch] = useReducer(authReducer, {
    loading: false,
    isAuthenticated: false,
    initialized: false,
  });

  const { token, localProxyValue, logout } = useAuthStore();

  useEffect(() => {
    if (!hasHydrated) return;

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

    dispatch({ type: 'INITIALIZE', payload: { isAuthenticated: !!token } });
  }, [hasHydrated, token, localProxyValue, logout]);

  // Show loading until persisted auth is rehydrated so we don't redirect
  // logged-in users to /login briefly
  if (!hasHydrated || state.loading || !state.initialized) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    );
  }
  return state.isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

// Main route configuration
const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/signup" element={<Signup />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/history" element={<History />} />
        <Route
          path="/setting"
          element={<Navigate to="/history?tab=settings" replace />}
        />
        <Route
          path="/setting/*"
          element={<Navigate to="/history?tab=settings" replace />}
        />
      </Route>
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>
);

export default AppRoutes;
