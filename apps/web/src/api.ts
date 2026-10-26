const tokenKey = "ponto-pan.access-token";

export function getAccessToken(): string | null {
  return sessionStorage.getItem(tokenKey);
}

export function setAccessToken(token: string): void {
  sessionStorage.setItem(tokenKey, token);
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(tokenKey);
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`/api${path}`, { ...init, headers });
  if (response.status === 401) {
    clearAccessToken();
    window.dispatchEvent(new Event("auth-expired"));
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Não foi possível concluir a solicitação.";
    throw new Error(message);
  }
  return payload as T;
}
