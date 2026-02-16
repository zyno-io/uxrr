import { getAccessToken } from './auth';

export async function fetchWsToken(): Promise<string> {
    const accessToken = getAccessToken();
    const headers: Record<string, string> = {};
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch('/v1/auth/ws-token', {
        method: 'POST',
        headers
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch WS token: ${response.status}`);
    }

    const body: { token: string } = await response.json();
    return body.token;
}
