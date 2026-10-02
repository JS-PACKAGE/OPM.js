export interface CliOutput {
    out(line: string): void;
    err(line: string): void;
}
/** Returns a process exit code. Machine-readable results are one JSON object on stdout. */
export declare function main(argv: readonly string[], io?: CliOutput): Promise<number>;
