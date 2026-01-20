import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { appearance } = useAuthStore();

	useEffect(() => {
		// set data-theme attribute based on appearance
		const root = document.documentElement;

		// remove all possible data-theme attributes
		root.removeAttribute('data-theme');

		switch (appearance) {
			case 'transparent':
				root.setAttribute('data-theme', 'transparent');
				break;
			case 'light':
				root.setAttribute('data-theme', 'light');
				break;
			case 'dark':
			default:
				root.setAttribute('data-theme', 'dark');
		}
	}, [appearance]);

	// initialize theme
	useEffect(() => {
		const root = document.documentElement;
		const currentTheme = root.getAttribute('data-theme');

		if (!currentTheme) {
			root.setAttribute('data-theme', appearance === 'transparent' ? 'transparent' : appearance === 'light' ? 'light' : 'dark');
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []); // only execute once when the component is mounted

  return <>{children}</>;
} 