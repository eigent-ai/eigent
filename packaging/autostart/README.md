# Eigent Autostart

Desktop entry to start Eigent automatically on login.

## Install

```bash
# Copy to autostart directory
cp eigent-autostart.desktop ~/.config/autostart/

# Or system-wide
sudo cp eigent-autostart.desktop /etc/xdg/autostart/
```

## Disable

```bash
# Remove the file
rm ~/.config/autostart/eigent-autostart.desktop

# Or disable via desktop environment settings
# GNOME: Tweaks → Startup Applications
# KDE: System Settings → Startup and Shutdown → Autostart
```

## Options

Edit the desktop file to customize:

- Remove `--hidden` from `Exec=` to show window on startup
- Change `X-GNOME-Autostart-Delay=5` to adjust delay (seconds)
- Set `X-GNOME-Autostart-enabled=false` to disable without removing
