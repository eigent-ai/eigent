Name:           eigent
Version:        0.0.82
Release:        1%{?dist}
Summary:        AI-powered desktop agent for browser automation

License:        Apache-2.0
URL:            https://eigent.ai
Source0:        https://github.com/eigent-ai/eigent/releases/download/v%{version}/Eigent-%{version}.AppImage

ExclusiveArch:  x86_64

BuildRequires:  squashfs-tools
Requires:       gtk3
Requires:       libnotify
Requires:       nss
Requires:       libXScrnSaver
Requires:       libXtst
Requires:       xdg-utils
Requires:       at-spi2-core
Requires:       libuuid
Requires:       libsecret

%description
Eigent is an AI-powered desktop agent that automates browser tasks.
It can navigate websites, fill forms, extract data, and perform
complex multi-step workflows autonomously.

%prep
chmod +x %{SOURCE0}
%{SOURCE0} --appimage-extract

%install
install -d %{buildroot}/opt/%{name}
cp -r squashfs-root/* %{buildroot}/opt/%{name}/

# Launcher script
install -d %{buildroot}%{_bindir}
cat > %{buildroot}%{_bindir}/%{name} << 'EOF'
#!/bin/bash
exec /opt/eigent/eigent "$@"
EOF
chmod +x %{buildroot}%{_bindir}/%{name}

# Desktop entry
install -Dm644 squashfs-root/%{name}.desktop %{buildroot}%{_datadir}/applications/%{name}.desktop
sed -i "s|Exec=.*|Exec=%{_bindir}/%{name} %%U|g" %{buildroot}%{_datadir}/applications/%{name}.desktop
sed -i "s|Icon=.*|Icon=%{name}|g" %{buildroot}%{_datadir}/applications/%{name}.desktop

# Icons
for size in 16 32 48 64 128 256 512; do
    if [ -f "squashfs-root/usr/share/icons/hicolor/${size}x${size}/apps/%{name}.png" ]; then
        install -Dm644 "squashfs-root/usr/share/icons/hicolor/${size}x${size}/apps/%{name}.png" \
            "%{buildroot}%{_datadir}/icons/hicolor/${size}x${size}/apps/%{name}.png"
    fi
done

# Man page
install -Dm644 %{_sourcedir}/../man/eigent.1 %{buildroot}%{_mandir}/man1/%{name}.1 || true

# Fix permissions
find %{buildroot}/opt/%{name} -type d -exec chmod 755 {} \;
find %{buildroot}/opt/%{name} -type f -exec chmod 644 {} \;
chmod +x %{buildroot}/opt/%{name}/%{name}
[ -f "%{buildroot}/opt/%{name}/chrome-sandbox" ] && chmod 4755 %{buildroot}/opt/%{name}/chrome-sandbox

%post
/usr/bin/gtk-update-icon-cache %{_datadir}/icons/hicolor &>/dev/null || :
/usr/bin/update-desktop-database %{_datadir}/applications &>/dev/null || :

%postun
/usr/bin/gtk-update-icon-cache %{_datadir}/icons/hicolor &>/dev/null || :
/usr/bin/update-desktop-database %{_datadir}/applications &>/dev/null || :

%files
/opt/%{name}
%{_bindir}/%{name}
%{_datadir}/applications/%{name}.desktop
%{_datadir}/icons/hicolor/*/apps/%{name}.png
%{_mandir}/man1/%{name}.1* || true

%changelog
* %(date "+%a %b %d %Y") Eigent AI <support@eigent.ai> - %{version}-1
- Update to version %{version}
