/*
 * Copyright 2024 Eigent
 *
 * Licensed under the Apache License, Version 2.0
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { useEffect, useState } from "react";
import { fetchGet } from "@/api/http";

type HealthResponse = {
  status: string;
  service: string;
};

export default function Diagnostics() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchGet("/health")
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
      <p>Service: {data.service}</p>
    </div>
  );
}