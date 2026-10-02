export declare const voiceSchema: {
    $schema: string;
    title: string;
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        version: {
            const: number;
        };
        name: {
            type: string;
            pattern: string;
        };
        algorithm: {
            type: string;
            minimum: number;
            maximum: number;
        };
        feedback: {
            type: string;
            minimum: number;
            maximum: number;
        };
        modIndex: {
            type: string;
            minimum: number;
            maximum: number;
        };
        lfo: {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                rate: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                amDepth: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                pmDepth: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
            };
        };
        ops: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    velocitySensitivity: {
                        type: string;
                        minimum: number;
                        maximum: number;
                        description: string;
                    };
                    keyScale: {
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            breakpoint: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            leftDbPerOctave: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            rightDbPerOctave: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                        };
                    };
                    ratio: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    level: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    detune: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    adsr: {
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            a: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            d: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            s: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            r: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                        };
                    };
                };
            };
        };
    };
};
