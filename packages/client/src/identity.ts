import type { UxrrIdentity } from './types';

const DEVICE_ID_KEY = 'uxrr:deviceId';

export class IdentityManager {
    private _deviceId: string;
    private _deviceIdPrefix?: string;
    private _userId?: string;
    private _userName?: string;
    private _userEmail?: string;
    private _customDeviceId = false;

    constructor() {
        const stored = localStorage.getItem(DEVICE_ID_KEY);
        if (stored) {
            this._deviceId = stored;
        } else {
            this._deviceId = crypto.randomUUID();
            localStorage.setItem(DEVICE_ID_KEY, this._deviceId);
        }
    }

    identify(identity: UxrrIdentity): void {
        if (identity.deviceId !== undefined) {
            this._deviceId = identity.deviceId;
            this._customDeviceId = true;
            localStorage.setItem(DEVICE_ID_KEY, this._deviceId);
        }

        if ('deviceIdPrefix' in identity) {
            this._deviceIdPrefix = identity.deviceIdPrefix;
        }

        if ('userId' in identity) {
            this._userId = identity.userId;
        }

        if ('userName' in identity) {
            this._userName = identity.userName;
        }

        if ('userEmail' in identity) {
            this._userEmail = identity.userEmail;
        }
    }

    get deviceId(): string {
        if (this._customDeviceId || !this._deviceIdPrefix) {
            return this._deviceId;
        }
        return this._deviceIdPrefix + this._deviceId;
    }

    get userId(): string | undefined {
        return this._userId;
    }

    toPayload(): Record<string, string | undefined> {
        return {
            deviceId: this.deviceId,
            userId: this._userId,
            userName: this._userName,
            userEmail: this._userEmail
        };
    }

    toSpanAttributes(): Record<string, string> {
        const attrs: Record<string, string> = {
            'uxrr.did': this.deviceId
        };
        if (this._userId) {
            attrs['uxrr.uid'] = this._userId;
        }
        return attrs;
    }
}
