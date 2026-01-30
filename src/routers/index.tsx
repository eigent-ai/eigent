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

import { lazy, useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

import Layout from "@/components/Layout";

// Lazy load page components
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/SignUp"));
const Home = lazy(() => import("@/pages/Home"));
const History = lazy(() => import("@/pages/History"));
const Diagnostics = lazy(() => import("@/pages/Diagnostics"));
const NotFound = lazy(() => import("@/pages/NotFound"));

// Route guard: Check if user is logged in
const ProtectedRoute = () => {
	const [loading, setLoading] = useState(false);
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [initialized, setInitialized] = useState(false);

	const { token, localProxyValue, logout } = useAuthStore();

	useEffect(() => {
		// Check VITE_USE_LOCAL_PROXY value on app startup
		if (token) {
			const currentProxyValue = import.meta.env.VITE_USE_LOCAL_PROXY || null;
			const storedProxyValue = localProxyValue;

			// If stored value exists and differs from current, logout
			if (storedProxyValue !== null && storedProxyValue !== currentProxyValue) {
				console.warn("VITE_USE_LOCAL_PROXY value changed, logging out user");
				logout();
				setIsAuthenticated(false);
				setLoading(false);
				setInitialized(true);
				return;
			}
		}

		setIsAuthenticated(!!token);
		setLoading(false);
		setInitialized(true);
	}, [token, localProxyValue, logout]);

	if (loading || !initialized) {
		return (
			<div className="flex items-center justify-center h-screen">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
			</div>
		);
	}

	return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

// Main route configuration
const AppRoutes = () => (
	<Routes>
		{/* Public routes */}
		<Route path="/login" element={<Login />} />
		<Route path="/signup" element={<Signup />} />

		{/* Protected routes */}
		<Route element={<ProtectedRoute />}>
			<Route element={<Layout />}>
				<Route path="/" element={<Home />} />
				<Route path="/history" element={<History />} />
				<Route path="/diagnostics" element={<Diagnostics />} />
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

		{/* Fallback */}
		<Route path="*" element={<NotFound />} />
	</Routes>
);

export default AppRoutes;
