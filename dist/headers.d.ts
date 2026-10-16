export interface HeaderOptions {
    accountId?: string;
    version: string;
}
/**
 * Builds the standard set of headers Kilo's gateway expects: attribution
 * headers, the client User-Agent/editor name, and (when an organization is
 * selected) the organization-scoping header.
 */
export declare function buildKiloHeaders({ accountId, version }: HeaderOptions): Record<string, string>;
