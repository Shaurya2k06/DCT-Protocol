import { LoggingLevel, LoggingConfig, type Commit, type Reveal, type ProverConfig, type Method, NetworkSetting, VerifierConfig, VerifierOutput, VerifyingKey, ConnectionInfo, PartialTranscript } from 'tlsn-wasm';
import { PresentationJSON } from './types';
import { Transcript, subtractRanges, mapStringToRange } from './transcript';
export default function init(config?: {
    loggingLevel?: LoggingLevel;
    hardwareConcurrency?: number;
}): Promise<void>;
export declare class Prover {
    #private;
    static notarize(options: {
        url: string;
        notaryUrl: string;
        websocketProxyUrl: string;
        method?: Method;
        headers?: {
            [name: string]: string;
        };
        body?: unknown;
        maxSentData?: number;
        maxSentRecords?: number;
        maxRecvData?: number;
        maxRecvDataOnline?: number;
        maxRecvRecordsOnline?: number;
        network?: NetworkSetting;
        deferDecryptionFromStart?: boolean;
        commit?: Commit;
        serverIdentity?: boolean;
        clientAuth?: [number[][], number[]];
    }): Promise<PresentationJSON>;
    constructor(config: {
        serverDns: string;
        maxSentData?: number;
        maxSentRecords?: number;
        maxRecvData?: number;
        maxRecvDataOnline?: number;
        maxRecvRecordsOnline?: number;
        deferDecryptionFromStart?: boolean;
        network?: NetworkSetting;
        clientAuth?: [number[][], number[]] | undefined;
    });
    free(): Promise<void>;
    setup(verifierUrl: string): Promise<void>;
    transcript(): Promise<{
        sent: number[];
        recv: number[];
    }>;
    static getHeaderMap(url: string, body?: unknown, headers?: {
        [key: string]: string;
    }): Map<string, number[]>;
    sendRequest(wsProxyUrl: string, request: {
        url: string;
        method?: Method;
        headers?: {
            [key: string]: string;
        };
        body?: unknown;
    }): Promise<{
        status: number;
        headers: {
            [key: string]: string;
        };
    }>;
    notarize(commit?: Commit): Promise<{
        attestation: string;
        secrets: string;
        notaryUrl?: string;
        websocketProxyUrl?: string;
    }>;
    reveal(reveal: Reveal): Promise<void>;
}
export declare class Verifier {
    #private;
    constructor(config: {
        maxSentData?: number;
        maxRecvData?: number;
        maxSentRecords?: number;
        maxRecvRecordsOnline?: number;
    });
    verify(): Promise<VerifierOutput>;
    connect(proverUrl: string): Promise<void>;
}
export declare class Presentation {
    #private;
    constructor(params: {
        attestationHex: string;
        secretsHex: string;
        notaryUrl?: string;
        websocketProxyUrl?: string;
        reveal?: Reveal;
    } | string);
    free(): Promise<void>;
    serialize(): Promise<string>;
    verifyingKey(): Promise<VerifyingKey>;
    json(): Promise<PresentationJSON>;
    verify(): Promise<VerifierOutput>;
}
export declare class Attestation {
    #private;
    constructor(attestationHex: string);
    free(): Promise<void>;
    verifyingKey(): Promise<VerifyingKey>;
    serialize(): Promise<Uint8Array>;
}
export declare class Secrets {
    #private;
    constructor(secretsHex: string);
    free(): Promise<void>;
    serialize(): Promise<Uint8Array>;
    transcript(): Promise<import("tlsn-wasm").Transcript>;
}
export declare class NotaryServer {
    #private;
    static from(url: string): NotaryServer;
    constructor(url: string);
    get url(): string;
    publicKey(encoding?: 'pem' | 'hex'): Promise<string>;
    normalizeUrl(): string;
    sessionUrl(maxSentData?: number, maxRecvData?: number): Promise<string>;
}
export { type LoggingLevel, type LoggingConfig, type Commit, type Method, type Reveal, type ProverConfig, type VerifierConfig, type VerifyingKey, type VerifierOutput, type ConnectionInfo, type PartialTranscript, Transcript, mapStringToRange, subtractRanges, };
//# sourceMappingURL=lib.d.ts.map