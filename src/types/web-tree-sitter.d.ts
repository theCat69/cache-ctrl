declare module "web-tree-sitter" {
  export interface SyntaxNode {
    readonly type: string;
    readonly startIndex: number;
    readonly endIndex: number;
    readonly childCount: number;
    child(index: number): SyntaxNode | null;
  }

  export interface Tree {
    readonly rootNode: SyntaxNode;
  }

  export interface QueryCapture {
    readonly node: SyntaxNode;
  }

  export declare class Query {
    constructor(language: Language, source: string);
    captures(node: SyntaxNode): QueryCapture[];
  }

  export declare class Language {
    static load(path: string | Uint8Array): Promise<Language>;
  }

  export interface Parser {
    parse(input: string): Tree | null;
  }
}
