export async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string')
        message = body.message;
    } catch {
      /* The API may be unavailable behind the development proxy. */
    }
    throw new Error(message);
  }
  return response.json();
}
