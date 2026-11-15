export type CodeTableName = 'cp437' | 'cp850' | 'cp858' | 'wpc1252';

export interface EscPosOptions {
  /** Characters per line at normal size. 48 for 80 mm paper, 32 for 58 mm. Default 48. */
  width?: number;
  /** Character table for text. Default 'cp858'. */
  codeTable?: CodeTableName;
  /** The printer's ESC t number for that table, when it differs from the usual one. */
  codeTableNumber?: number;
}

export declare class EscPos {
  constructor(options?: EscPosOptions);
  readonly width: number;
  /** Characters that fit on one line at the current size. */
  readonly columns: number;
  /** Characters that couldn't be printed and came out as "?". */
  readonly replaced: string[];
  codeTable(name: CodeTableName, number?: number): this;
  align(where: 'left' | 'center' | 'right'): this;
  bold(on?: boolean): this;
  underline(on?: boolean): this;
  /** Width and height multipliers, 1-8. */
  size(width?: number, height?: number): this;
  /** Wrapped text ending with a line break; `indent` starts continuation lines with spaces. */
  text(value?: string, options?: { indent?: number }): this;
  leftRight(left: string, right: string): this;
  rule(char?: string): this;
  feed(lines?: number): this;
  cut(options?: { partial?: boolean; feed?: number }): this;
  raw(bytes: Iterable<number>): this;
  toBytes(): Uint8Array;
  toBase64(): string;
}

export declare class CodeTable {
  constructor(name: CodeTableName, number?: number);
  readonly name: CodeTableName;
  readonly number: number;
  canPrint(char: string): boolean;
  prepare(text: string): { text: string; replaced: string[] };
  encode(preparedText: string): number[];
}

export declare function wrap(text: string, width: number, indent?: number): string[];

export interface TestSheetOptions {
  width?: number;
  tables?: { name: CodeTableName; number: number }[];
  title?: string;
}

export declare function testSheet(options?: TestSheetOptions): EscPos;

export declare const CODE_TABLES: CodeTableName[];
export declare const DEFAULT_NUMBERS: Record<CodeTableName, number>;
