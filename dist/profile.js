/** Fetches the authenticated user's Kilo profile, including organizations. */
export async function fetchProfile(baseUrl, token, fetchImpl = fetch) {
    const res = await fetchImpl(`${baseUrl}/api/profile`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
        throw new Error("Invalid or expired Kilo token");
    }
    if (!res.ok) {
        throw new Error(`Failed to fetch Kilo profile: HTTP ${res.status}`);
    }
    const body = (await res.json());
    const profile = { email: body.user.email };
    if (body.user.name !== undefined)
        profile.name = body.user.name;
    if (body.organizations !== undefined)
        profile.organizations = body.organizations;
    if (body.selectedOrganizationId)
        profile.selectedOrganizationId = body.selectedOrganizationId;
    if (body.hasPersonalAccount !== undefined)
        profile.hasPersonalAccount = body.hasPersonalAccount;
    return profile;
}
/**
 * Determines the organization to select by default after login: the
 * server's `selectedOrganizationId` if it names a real organization,
 * otherwise the first organization when there is no personal account,
 * otherwise `undefined` (meaning: use the personal account).
 */
export function defaultOrganizationId(profile) {
    const orgs = profile.organizations ?? [];
    if (profile.selectedOrganizationId && orgs.some((org) => org.id === profile.selectedOrganizationId)) {
        return profile.selectedOrganizationId;
    }
    if (profile.hasPersonalAccount === false && orgs.length > 0) {
        return orgs[0].id;
    }
    return undefined;
}
/**
 * Builds the native `select` prompt options for the "Switch organization"
 * auth method: a "Personal account" entry plus one entry per organization.
 */
export function organizationSelectOptions(profile) {
    const orgs = profile.organizations ?? [];
    const options = [{ label: "Personal account", value: "" }];
    for (const org of orgs) {
        options.push({ label: org.name, value: org.id, hint: org.role });
    }
    return options;
}
