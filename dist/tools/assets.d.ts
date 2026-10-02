export interface CopyAssetsOptions {
    destination: string;
    /** Advanced: deploy this installed opm.js package directory instead of the one containing this module. */
    packageRoot?: string;
}
export interface AssetDeployment {
    readonly version: string;
    readonly destination: string;
    readonly files: number;
    readonly bytes: number;
    readonly reused: boolean;
}
export interface CheckDeploymentOptions {
    /** Overall deadline, integer milliseconds in 1..60000; default 15000. */
    timeoutMs?: number;
    /** Require production X-Content-Type-Options: nosniff; default true. */
    requireNosniff?: boolean;
    /** Advanced: compare with this installed opm.js package directory instead of the one containing this module. */
    packageRoot?: string;
}
export interface DeploymentCheck {
    readonly version: string;
    readonly baseUrl: string;
    readonly files: number;
    readonly bytes: number;
    readonly limitations: readonly string[];
}
/** Node-only. Atomically create a complete release-specific directory; never overwrite host files. */
export declare function copyAssets(options: CopyAssetsOptions): Promise<AssetDeployment>;
/** Fetch and hash the complete installed release; this does not certify page CSP or audible playback. */
export declare function checkDeployment(baseUrl: string | URL, options?: CheckDeploymentOptions): Promise<DeploymentCheck>;
