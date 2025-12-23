export type TableResourceDescriptor =
  | {
      mode: 'ldp';
      containerUrl: string;
      resourceUrl: string;
    }
  | {
      mode: 'sparql';
      endpoint: string;
    };
