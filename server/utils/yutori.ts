interface CreateScoutParams {
  name: string;
  query: string;
  sources?: string[];
}

interface YutoriUpdateItem {
  id?: string;
  title?: string;
  name?: string;
  startISO?: string;
  endISO?: string;
  cancelled?: boolean;
  summary?: string;
  snippet?: string;
  [key: string]: unknown;
}

const getYutoriConfig = (): { apiKey: string; baseUrl: string } | null => {
  const apiKey = process.env.YUTORI_API_KEY;
  const baseUrl = process.env.YUTORI_BASE_URL ?? "https://api.yutori.com/v1";

  if (!apiKey) {
    return null;
  }

  return { apiKey, baseUrl };
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const config = getYutoriConfig();
  if (!config) {
    throw new Error("Yutori is not configured");
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Yutori request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
};

export const createScout = async ({
  name,
  query,
  sources = []
}: CreateScoutParams): Promise<{ scoutId: string; raw: unknown }> => {
  const payload = { name, query, sources };
  const data = await request<{ id?: string; scoutId?: string }>("/scouts", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const scoutId = data.scoutId ?? data.id;
  if (!scoutId) {
    throw new Error("Yutori response missing scoutId");
  }

  return { scoutId, raw: data };
};

export const getScoutUpdates = async (scoutId: string): Promise<{ updates: YutoriUpdateItem[]; raw: unknown }> => {
  const data = await request<{ updates?: YutoriUpdateItem[] }>(`/scouts/${encodeURIComponent(scoutId)}/updates`, {
    method: "GET"
  });

  return { updates: data.updates ?? [], raw: data };
};
