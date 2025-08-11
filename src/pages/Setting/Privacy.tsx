import { Switch } from "@/components/ui/switch";
import { useState, useEffect } from "react";
import { proxyFetchGet, proxyFetchPut } from "@/api/http";

export default function SettingPrivacy() {
  const API_FIELDS = [
    "take_screenshot",
    "access_local_software",
    "access_your_address",
    "password_storage",
  ];
  const [settings, setSettings] = useState([
    {
      title: "Allow Agent to Take Screenshots",
      description:
        "Permit the agent to capture screenshots of your computer screen. This can be used for support, diagnostics, or monitoring purposes. Screenshots may include visible personal information, so please enable with care.",
      checked: false,
    },
    {
      title: "Allow Agent to Access Local Software",
      description:
        "Grant the agent permission to interact with and utilize software installed on your local machine. This may be necessary for troubleshooting, running diagnostics, or performing specific tasks.",
      checked: false,
    },
    {
      title: "Allow Agent to Access Your Address",
      description:
        "Authorize the agent to view and use your location or address details. This may be required for location-based services or personalized support.",
      checked: false,
    },
    {
      title: "Password Storage",
      description:
        "Determine how passwords are handled and stored. You can choose to store passwords securely on the device or within the application, or opt out to manually enter them each time. All stored passwords are encrypted.",
      checked: false,
    },
  ]);

  useEffect(() => {
    proxyFetchGet("/api/user/privacy")
      .then((res) => {
        setSettings((prev) =>
          prev.map((item, index) => ({
            ...item,
            checked: res[API_FIELDS[index]] || false,
          }))
        );
      })
      .catch((err) => console.error("Failed to fetch settings:", err));
  }, []);

  const handleToggle = (index: number) => {
    setSettings((prev) => {
      const newSettings = [...prev];
      newSettings[index] = {
        ...newSettings[index],
        checked: !newSettings[index].checked,
      };
      return newSettings;
    });

    const requestData = {
      [API_FIELDS[0]]: settings[0].checked,
      [API_FIELDS[1]]: settings[1].checked,
      [API_FIELDS[2]]: settings[2].checked,
      [API_FIELDS[3]]: settings[3].checked,
    };

    requestData[API_FIELDS[index]] = !settings[index].checked;

    proxyFetchPut("/api/user/privacy", requestData).catch((err) =>
      console.error("Failed to update settings:", err)
    );
  };
  return (
    <div className="space-y-8">
      {settings.map((item, index) => (
        <div className="px-6 py-4 bg-surface-secondary rounded-2xl" key={item.title}>
          <div className="flex gap-md">
            <div>
              <div className="text-base font-bold leading-12 text-text-primary">
                {item.title}
              </div>
              <div className="text-sm leading-13">{item.description}</div>
            </div>
            <div>
              <Switch
                checked={item.checked}
                onCheckedChange={() => handleToggle(index)}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
