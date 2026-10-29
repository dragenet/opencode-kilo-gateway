export interface KiloOrganization {
    id: string;
    name: string;
    role: string;
}
export interface KiloProfile {
    email: string;
    name?: string;
    organizations?: KiloOrganization[];
    selectedOrganizationId?: string;
    hasPersonalAccount?: boolean;
}
export interface SelectOption {
    label: string;
    value: string;
    hint?: string;
}
/** Fetches the authenticated user's Kilo profile, including organizations. */
export declare function fetchProfile(baseUrl: string, token: string, fetchImpl?: typeof fetch): Promise<KiloProfile>;
/**
 * Determines the organization to select by default after login: the
 * server's `selectedOrganizationId` if it names a real organization,
 * otherwise the first organization when there is no personal account,
 * otherwise `undefined` (meaning: use the personal account).
 */
export declare function defaultOrganizationId(profile: KiloProfile): string | undefined;
/**
 * Builds the native `select` prompt options for the "Switch organization"
 * auth method: a "Personal account" entry plus one entry per organization.
 */
export declare function organizationSelectOptions(profile: KiloProfile): SelectOption[];
