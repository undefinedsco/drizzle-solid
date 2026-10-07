/** An HTTP authorization rejection remains known even if its response body breaks. */
export class ConditionalHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export async function readConditionalResponse(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    try { await response.text(); } catch { /* Preserve the authorization status even if its body is incomplete. */ }
    throw new ConditionalHttpError(response.status, 'Conditional resource authorization failed');
  }
  return response.text();
}
