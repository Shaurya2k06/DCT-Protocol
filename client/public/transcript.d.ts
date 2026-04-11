export declare class Transcript {
    #private;
    constructor(params: {
        sent: number[];
        recv: number[];
    });
    get raw(): {
        recv: number[];
        sent: number[];
    };
    recv(redactedSymbol?: string): string;
    sent(redactedSymbol?: string): string;
    text: (redactedSymbol?: string) => {
        sent: string;
        recv: string;
    };
}
export declare function subtractRanges(ranges: {
    start: number;
    end: number;
}, negatives: {
    start: number;
    end: number;
}[]): {
    start: number;
    end: number;
}[];
export declare function mapStringToRange(secrets: string[], text: string): {
    start: number;
    end: number;
}[];
//# sourceMappingURL=transcript.d.ts.map