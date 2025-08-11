import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { appearance } = useAuthStore();

	useEffect(() => {
		// set data-theme attribute based on appearance
		const root = document.documentElement;

		// remove all possible data-theme attributes
		root.removeAttribute('data-theme');

		// set the corresponding data-theme based on appearance
		if (appearance === "transparent") {
			root.setAttribute("data-theme", "transparent");
		} else if (appearance === "light") {
      root.setAttribute('data-theme', 'light');
    } else if (appearance === 'dark') {
      root.setAttribute('data-theme', 'dark');
    }
    else {
      root.setAttribute('data-theme', 'light');
    }

  }, [appearance]);

	// initialize theme
	useEffect(() => {
		const root = document.documentElement;
		const currentTheme = root.getAttribute("data-theme");

    if (!currentTheme) {
      if (appearance === 'transparent') {
        root.setAttribute('data-theme', 'transparent');
      } else if (appearance === 'dark') {
        root.setAttribute('data-theme', 'dark');
      } else {
        root.setAttribute('data-theme', 'light');
      }
		}
	}, []); // only execute once when the component is mounted

  return <>{children}</>;
} 