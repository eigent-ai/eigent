import { useEffect, useState } from "react";

type HealthResponse = {
  status: string;
  service: string;
  database: {
    status: string;
  };
};

export default function Diagnostics() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error("Backend unreachable");
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return <div>❌ {error}</div>;
  }

  if (!data) {
    return <div>Loading system diagnostics...</div>;
  }

  return (
    <div style={{ padding: "16px" }}>
      <h2>System Diagnostics</h2>

      <p>Backend: ✅ Running</p>

      <p>
        Database:{" "}
        {data.database.status === "ok" ? "✅ Connected" : "❌ Error"}
      </p>
    </div>
  );
}
