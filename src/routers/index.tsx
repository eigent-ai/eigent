import { lazy, useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

import Layout from "@/components/Layout";
// Lazy load page components
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/SignUp"));
const Home = lazy(() => import("@/pages/Home"));
const History = lazy(() => import("@/pages/History"));
const NotFound = lazy(() => import("@/pages/NotFound"));

// Route guard: Check if user is logged in
const ProtectedRoute = () => {
	const [loading, setLoading] = useState(false);
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [initialized, setInitialized] = useState(false);

	const authStore = useAuthStore();
	useEffect(() => {
		setIsAuthenticated(!!authStore.token);
		setLoading(false);
		setInitialized(true);
	}, [authStore.token]);
	
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
		<Route path="/login" element={<Login />} />
		<Route path="/signup" element={<Signup />} />
		<Route element={<ProtectedRoute />}>
			<Route element={<Layout />}>
				<Route path="/" element={<Home />} />
				<Route path="/history" element={<History />} />
				<Route path="/setting" element={<Navigate to="/history?tab=settings" replace />} />
				<Route path="/setting/*" element={<Navigate to="/history?tab=settings" replace />} />
			</Route>
		</Route>
		<Route path="*" element={<NotFound />} />
	</Routes>
);

export default AppRoutes;
