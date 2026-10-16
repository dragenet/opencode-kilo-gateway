export interface DeviceAuthInit {
    code: string;
    verificationUrl: string;
    expiresIn: number;
}
export interface DeviceAuthPollResult {
    status: "pending" | "approved" | "denied" | "expired";
    token?: string;
    userEmail?: string;
}
/** Starts a Kilo device-authorization grant: `POST /api/device-auth/codes`. */
export declare function initiateDeviceAuth(baseUrl: string, fetchImpl?: typeof fetch): Promise<DeviceAuthInit>;
/** Performs a single poll of `GET /api/device-auth/codes/{code}`. */
export declare function pollDeviceAuthOnce(baseUrl: string, code: string, fetchImpl?: typeof fetch): Promise<DeviceAuthPollResult>;
export interface WaitForDeviceAuthOptions {
    pollIntervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
}
/**
 * Polls `pollDeviceAuthOnce` on an interval until the user approves/denies
 * the device code, it expires, or the code's `expiresIn` window elapses.
 */
export declare function waitForDeviceAuthApproval(baseUrl: string, init: DeviceAuthInit, fetchImpl?: typeof fetch, options?: WaitForDeviceAuthOptions): Promise<DeviceAuthPollResult>;
